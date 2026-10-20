package realtime

import (
	"context"
	"time"

	"github.com/centrifugal/centrifuge"
	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpod/internal/auth"
	"github.com/asano69/cardpod/internal/replica"
)

const (
	// historySize and historyTTL bound how much a channel remembers for
	// recovery after a short disconnect. Tune these from real usage.
	historySize = 1000
	historyTTL  = 10 * time.Minute
)

// MergeAlertChannel carries the duplicate-title alerts of cards (see
// PublishMergeAlert). Unlike the replicated collections' channels, it holds
// no records.
const MergeAlertChannel = "card_alerts"

// RenameAlertChannel carries the alerts sent when a card is renamed away from
// a title other cards still link to (see PublishRenameAlert).
const RenameAlertChannel = "card_rename_alerts"

// Hub owns the centrifuge node and publishes the changes of every replicated
// collection (see internal/replica) to the channel named after it. The app is
// small enough that each client simply receives all events of a channel, and
// the frontend ignores records it does not hold.
type Hub struct {
	node    *centrifuge.Node
	publish func(channel string, data []byte) error // replaceable in tests
}

// New creates and starts the hub. Only authenticated users may connect (see
// auth.Verify), and they may only subscribe to the channel of a replicated
// collection or to MergeAlertChannel; clients can never publish, because no
// OnPublish handler is set.
func New(app core.App) (*Hub, error) {
	node, err := centrifuge.New(centrifuge.Config{})
	if err != nil {
		return nil, err
	}

	node.OnConnecting(func(_ context.Context, e centrifuge.ConnectEvent) (centrifuge.ConnectReply, error) {
		session, err := auth.Verify(app, e.Token)
		if err != nil {
			return centrifuge.ConnectReply{}, centrifuge.DisconnectInvalidToken
		}
		return centrifuge.ConnectReply{
			// The connection must present a fresh token before this one
			// expires (see OnRefresh below); the client SDK does that by
			// calling getToken again.
			Credentials:       &centrifuge.Credentials{UserID: session.UserID, ExpireAt: session.ExpiresAt.Unix()},
			ClientSideRefresh: true,
		}, nil
	})

	node.OnConnect(func(client *centrifuge.Client) {
		client.OnRefresh(func(e centrifuge.RefreshEvent, cb centrifuge.RefreshCallback) {
			session, err := auth.Verify(app, e.Token)
			// A connection never changes hands: the new token must belong
			// to the user who connected.
			if err != nil || session.UserID != client.UserID() {
				cb(centrifuge.RefreshReply{}, centrifuge.DisconnectInvalidToken)
				return
			}
			cb(centrifuge.RefreshReply{ExpireAt: session.ExpiresAt.Unix()}, nil)
		})
		client.OnSubscribe(func(e centrifuge.SubscribeEvent, cb centrifuge.SubscribeCallback) {
			if _, ok := replica.Find(e.Channel); !ok && e.Channel != MergeAlertChannel && e.Channel != RenameAlertChannel {
				cb(centrifuge.SubscribeReply{}, centrifuge.ErrorPermissionDenied)
				return
			}
			cb(centrifuge.SubscribeReply{
				Options: centrifuge.SubscribeOptions{EnableRecovery: true},
			}, nil)
		})
	})

	hub := &Hub{node: node}
	hub.publish = func(channel string, data []byte) error {
		_, err := node.Publish(channel, data, centrifuge.WithHistory(historySize, historyTTL))
		return err
	}

	if err := node.Run(); err != nil {
		return nil, err
	}
	return hub, nil
}
