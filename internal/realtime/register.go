package realtime

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/centrifugal/centrifuge"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpod/internal/replica"
)

// shutdownTimeout bounds how long Terminate waits for the node to close its
// connections, mirroring the yjs server's own shutdown in serve/ydoc.go.
const shutdownTimeout = 10 * time.Second

// Register starts the hub, mounts its WebSocket endpoint and publishes every
// change of a replicated collection to that collection's channel. It is meant
// to be called once from the server's OnServe hook, and returns the hub so
// other packages can publish through it (see PublishMergeAlert).
func Register(e *core.ServeEvent) (*Hub, error) {
	hub, err := New(e.App)
	if err != nil {
		return nil, fmt.Errorf("start realtime hub: %w", err)
	}
	hub.BindHooks(e.App)

	e.Router.GET("/connection/websocket",
		apis.WrapStdHandler(centrifuge.NewWebsocketHandler(hub.node, centrifuge.WebsocketConfig{})))

	e.App.OnTerminate().BindFunc(func(te *core.TerminateEvent) error {
		ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		if err := hub.node.Shutdown(ctx); err != nil {
			slog.Warn("realtime hub shutdown", "error", err)
		}
		return te.Next()
	})
	return hub, nil
}

// PublishMergeAlert tells clients that the card cardID duplicates the title
// of mergeTarget, or that it no longer duplicates anything when mergeTarget
// is empty (sent as null, so a shown alert is cleared).
func (h *Hub) PublishMergeAlert(cardID, mergeTarget string) error {
	var target any
	if mergeTarget != "" {
		target = mergeTarget
	}
	data, err := json.Marshal(map[string]any{"cardId": cardID, "mergeTarget": target})
	if err != nil {
		return err
	}
	return h.publish(MergeAlertChannel, data)
}

// PublishRenameAlert tells clients that the card cardID was renamed away from
// oldTitle, which the cards titled linkedFrom still link to.
func (h *Hub) PublishRenameAlert(cardID, oldTitle string, linkedFrom []string) error {
	data, err := json.Marshal(map[string]any{
		"cardId": cardID, "oldTitle": oldTitle, "linkedFrom": linkedFrom,
	})
	if err != nil {
		return err
	}
	return h.publish(RenameAlertChannel, data)
}

// BindHooks publishes an event for every successful create, update and
// delete of a record of a replicated collection.
func (h *Hub) BindHooks(app core.App) {
	for _, c := range replica.Collections {
		app.OnRecordAfterCreateSuccess(c.Name).BindFunc(h.hook("create"))
		app.OnRecordAfterUpdateSuccess(c.Name).BindFunc(h.hook("update"))
		app.OnRecordAfterDeleteSuccess(c.Name).BindFunc(h.hook("delete"))
	}
}

// hook publishes {action, record} -- the same shape PocketBase's own
// realtime sent -- to the channel named after the record's collection. A
// publish failure is only logged: it must never fail the save that already
// succeeded.
func (h *Hub) hook(action string) func(*core.RecordEvent) error {
	return func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		data, err := json.Marshal(map[string]any{"action": action, "record": e.Record})
		if err == nil {
			err = h.publish(e.Record.Collection().Name, data)
		}
		if err != nil {
			slog.Warn("publish record event", "action", action,
				"collection", e.Record.Collection().Name, "record", e.Record.Id, "error", err)
		}
		return nil
	}
}
