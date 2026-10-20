// card_views.go records who opened which card. A view is counted when a
// user's Yjs websocket connection is accepted (see yjs_auth.go), so cards
// opened while offline are not recorded.
//
// Each (card, user) pair has one row in "card_views": how many times the
// user opened the card, when they last did, and when they last left it (the
// "left" field, written when the websocket closes; see recordCardLeft). The
// two are independent: opening is deduped and counted, leaving is never
// deduped and only keeps the latest time. The collection is not listed
// in internal/replica on purpose: updating it must never reach the realtime
// channels or the clients' pull.
//
// Every counted view is also written to PocketBase's own log (see
// app.Logger), which keeps the raw "who, when, which card" history until
// its retention period expires.
package serve

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/asano69/cardpod/internal/api"
	"github.com/asano69/cardpod/internal/auth"
)

// viewDedupeWindow is how long after a counted view the same user opening
// the same card is not counted again. A websocket reconnect (network loss,
// token refresh) would otherwise count as a new view.
const viewDedupeWindow = 30 * time.Minute

// viewTracker remembers when each (user, card) pair was last counted. It
// only grows with the number of distinct pairs, which is small for this app.
type viewTracker struct {
	mu   sync.Mutex
	last map[string]time.Time
}

func newViewTracker() *viewTracker {
	return &viewTracker{last: make(map[string]time.Time)}
}

// shouldRecord reports whether a view at `now` is a new one, and remembers it
// if so.
func (t *viewTracker) shouldRecord(userID, cardID string, now time.Time) bool {
	key := userID + "/" + cardID

	t.mu.Lock()
	defer t.mu.Unlock()
	if prev, ok := t.last[key]; ok && now.Sub(prev) < viewDedupeWindow {
		return false
	}
	t.last[key] = now
	return true
}

// views is the single tracker shared by every connection, like
// titleWatcherInstance.
var views = newViewTracker()

// recordCardView counts a view of cardID by userID unless the same user
// already opened it recently. The database write runs in its own goroutine,
// so the websocket upgrade never waits for it. A failure is only logged: it
// must never affect opening the card.
func recordCardView(app core.App, userID, cardID string) {
	if !views.shouldRecord(userID, cardID, time.Now()) {
		return
	}
	app.Logger().Info("card view", "user", userID, "card", cardID)
	go func() {
		if err := upsertCardView(app, userID, cardID); err != nil {
			slog.Warn("record card view", "user", userID, "card", cardID, "error", err)
		}
	}()
}

// recordCardLeft stores the time userID left cardID's room. Unlike
// recordCardView it is never deduped: the latest leave always wins. With
// several tabs open on the same card, the last tab closed decides only if it
// is also the last to close, which is accepted for simplicity. A failure is
// only logged.
func recordCardLeft(app core.App, userID, cardID string) {
	go func() {
		if err := upsertCardLeft(app, userID, cardID); err != nil {
			slog.Warn("record card leave", "user", userID, "card", cardID, "error", err)
		}
	}()
}

// cardViewRow returns the (card, user) row, or a new unsaved one.
func cardViewRow(app core.App, userID, cardID string) (*core.Record, error) {
	record, err := app.FindFirstRecordByFilter(
		"card_views", "card = {:card} && user = {:user}",
		dbx.Params{"card": cardID, "user": userID},
	)
	if err == nil {
		return record, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	collection, err := app.FindCollectionByNameOrId("card_views")
	if err != nil {
		return nil, err
	}
	record = core.NewRecord(collection)
	record.Set("card", cardID)
	record.Set("user", userID)
	return record, nil
}

// upsertCardView adds one view to the (card, user) row, creating it on the
// first view.
func upsertCardView(app core.App, userID, cardID string) error {
	record, err := cardViewRow(app, userID, cardID)
	if err != nil {
		return err
	}
	record.Set("count", record.GetInt("count")+1)
	record.Set("viewed", types.NowDateTime())
	return app.Save(record)
}

// upsertCardLeft sets the "left" time of the (card, user) row to now,
// creating the row if it does not exist yet.
func upsertCardLeft(app core.App, userID, cardID string) error {
	record, err := cardViewRow(app, userID, cardID)
	if err != nil {
		return err
	}
	record.Set("left", types.NowDateTime())
	return app.Save(record)
}

// mergeSeen returns the per-client maximum of a and b. Clocks only grow, so
// merging in any order, any number of times, gives the same result and a
// stale writer can never lower what another device already stored.
func mergeSeen(a, b map[string]uint64) map[string]uint64 {
	merged := make(map[string]uint64, len(a)+len(b))
	for _, seen := range []map[string]uint64{a, b} {
		for client, clock := range seen {
			if clock > merged[client] {
				merged[client] = clock
			}
		}
	}
	return merged
}

// readSeen decodes the "seen" field of a card_views row. A row that has none
// yet gives an empty map, never nil.
func readSeen(record *core.Record) (map[string]uint64, error) {
	seen := map[string]uint64{}
	raw := record.GetString("seen")
	if raw == "" {
		return seen, nil
	}
	if err := json.Unmarshal([]byte(raw), &seen); err != nil {
		return nil, err
	}
	return seen, nil
}

// loadSeen returns what userID has seen of cardID.
func loadSeen(app core.App, userID, cardID string) (map[string]uint64, error) {
	record, err := cardViewRow(app, userID, cardID)
	if err != nil {
		return nil, err
	}
	return readSeen(record)
}

// mergeCardSeen merges incoming into the stored "seen" of the (card, user)
// row, creating the row if needed, and returns the stored result. Reading and
// writing share one transaction, so two devices posting at once cannot lose
// each other's clocks.
func mergeCardSeen(app core.App, userID, cardID string, incoming map[string]uint64) (map[string]uint64, error) {
	var merged map[string]uint64
	err := app.RunInTransaction(func(tx core.App) error {
		record, err := cardViewRow(tx, userID, cardID)
		if err != nil {
			return err
		}
		current, err := readSeen(record)
		if err != nil {
			return err
		}
		merged = mergeSeen(current, incoming)
		encoded, err := json.Marshal(merged)
		if err != nil {
			return err
		}
		record.Set("seen", types.JSONRaw(encoded))
		return tx.Save(record)
	})
	return merged, err
}

// checkSeenTarget fails with 404 unless the requested card exists and is not
// deleted.
func checkSeenTarget(e *core.RequestEvent) error {
	err := auth.CanAccessCard(e.App, e.Auth.Id, e.Request.PathValue("id"))
	if errors.Is(err, auth.ErrCardNotFound) {
		return e.NotFoundError("card not found", nil)
	}
	if err != nil {
		return e.InternalServerError("check access to the card", err)
	}
	return nil
}

// getSeenHandler serves GET /api/admin/cards/{id}/seen. A superuser is not
// tracked (see yjs_auth.go), so it always gets an empty result.
func getSeenHandler(e *core.RequestEvent) error {
	if err := checkSeenTarget(e); err != nil {
		return err
	}
	seen := map[string]uint64{}
	if !e.HasSuperuserAuth() {
		var err error
		seen, err = loadSeen(e.App, e.Auth.Id, e.Request.PathValue("id"))
		if err != nil {
			return e.InternalServerError("load what the user has seen", err)
		}
	}
	return e.JSON(http.StatusOK, api.SeenResponse{Seen: seen})
}

// postSeenHandler serves POST /api/admin/cards/{id}/seen. A superuser's post
// is accepted and ignored.
func postSeenHandler(e *core.RequestEvent) error {
	if err := checkSeenTarget(e); err != nil {
		return err
	}
	var req api.SeenRequest
	if err := e.BindBody(&req); err != nil {
		return e.BadRequestError("invalid request body", err)
	}
	if !e.HasSuperuserAuth() {
		if _, err := mergeCardSeen(e.App, e.Auth.Id, e.Request.PathValue("id"), req.Seen); err != nil {
			return e.InternalServerError("store what the user has seen", err)
		}
	}
	return e.NoContent(http.StatusNoContent)
}
