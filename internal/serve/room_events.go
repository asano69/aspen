// room_events.go records who joined which card's websocket room. A join is
// counted when a user's collab connection is accepted (see collab_auth.go), so
// cards opened while offline are not recorded.
//
// Each (card, user) pair has one row in "room_events": how many times the user
// joined the room, when they last joined ("joined") and when they last left
// ("left"). Joining is deduped and counted; leaving is never deduped and only
// keeps the latest time. The collection is not listed in internal/replica on
// purpose: updating it must never reach the realtime channels or the clients'
// pull.
//
// Every counted join is also written to PocketBase's own log (see
// app.Logger), which keeps the raw "who, when, which card" history until its
// retention period expires.
package serve

import (
	"database/sql"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const roomEventsCollection = "room_events"

// joinDedupeWindow is how long after a counted join the same user joining the
// same card is not counted again. A websocket reconnect (network loss, token
// refresh) would otherwise count as a new join.
const joinDedupeWindow = 30 * time.Minute

// joinTracker remembers when each (user, card) pair was last counted. It only
// grows with the number of distinct pairs, which is small for this app.
type joinTracker struct {
	mu   sync.Mutex
	last map[string]time.Time
}

func newJoinTracker() *joinTracker {
	return &joinTracker{last: make(map[string]time.Time)}
}

func joinKey(userID, cardID string) string { return userID + "/" + cardID }

// shouldRecord reports whether a join at `now` is a new one, and remembers it
// if so.
func (t *joinTracker) shouldRecord(userID, cardID string, now time.Time) bool {
	key := joinKey(userID, cardID)

	t.mu.Lock()
	defer t.mu.Unlock()
	if prev, ok := t.last[key]; ok && now.Sub(prev) < joinDedupeWindow {
		return false
	}
	t.last[key] = now
	return true
}

// forget drops what shouldRecord remembered, so a join whose write failed is
// counted again the next time.
func (t *joinTracker) forget(userID, cardID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.last, joinKey(userID, cardID))
}

// joins is the single tracker shared by every connection, like
// titleWatcherInstance.
var joins = newJoinTracker()

// recordRoomJoin counts a join of cardID's room by userID unless the same user
// joined it recently. The database write runs in its own goroutine, so the
// websocket upgrade never waits for it. A failure is only logged: it must
// never affect opening the card.
func recordRoomJoin(app core.App, userID, cardID string) {
	if !joins.shouldRecord(userID, cardID, time.Now()) {
		return
	}
	app.Logger().Info("room join", "user", userID, "card", cardID)
	go func() {
		if err := upsertRoomJoin(app, userID, cardID); err != nil {
			joins.forget(userID, cardID)
			slog.Warn("record room join", "user", userID, "card", cardID, "error", err)
		}
	}()
}

// recordRoomLeave stores the time userID left cardID's room. Unlike
// recordRoomJoin it is never deduped: the latest leave always wins. With
// several tabs open on the same card, the last one to close decides, which is
// accepted for simplicity. A failure is only logged.
func recordRoomLeave(app core.App, userID, cardID string) {
	go func() {
		if err := upsertRoomLeave(app, userID, cardID); err != nil {
			slog.Warn("record room leave", "user", userID, "card", cardID, "error", err)
		}
	}()
}

// roomEventRow returns the (card, user) row, or a new unsaved one.
func roomEventRow(app core.App, userID, cardID string) (*core.Record, error) {
	record, err := app.FindFirstRecordByFilter(
		roomEventsCollection, "card = {:card} && user = {:user}",
		dbx.Params{"card": cardID, "user": userID},
	)
	if err == nil {
		return record, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	collection, err := app.FindCachedCollectionByNameOrId(roomEventsCollection)
	if err != nil {
		return nil, err
	}
	record = core.NewRecord(collection)
	record.Set("card", cardID)
	record.Set("user", userID)
	return record, nil
}

// updateRoomEvent applies update to the (card, user) row and saves it. Reading
// and saving share one transaction, so a join and a leave that arrive at the
// same time can neither create the row twice nor overwrite each other's field
// with a stale copy.
func updateRoomEvent(app core.App, userID, cardID string, update func(*core.Record)) error {
	return app.RunInTransaction(func(tx core.App) error {
		record, err := roomEventRow(tx, userID, cardID)
		if err != nil {
			return err
		}
		update(record)
		return tx.Save(record)
	})
}

// upsertRoomJoin adds one join to the (card, user) row, creating it on the
// first join.
func upsertRoomJoin(app core.App, userID, cardID string) error {
	return updateRoomEvent(app, userID, cardID, func(record *core.Record) {
		record.Set("count", record.GetInt("count")+1)
		record.Set("joined", types.NowDateTime())
	})
}

// upsertRoomLeave sets the "left" time of the (card, user) row to now,
// creating the row if it does not exist yet.
func upsertRoomLeave(app core.App, userID, cardID string) error {
	return updateRoomEvent(app, userID, cardID, func(record *core.Record) {
		record.Set("left", types.NowDateTime())
	})
}
