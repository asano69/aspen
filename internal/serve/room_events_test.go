package serve

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// newRoomEventsTestApp extends newSlugTestApp with the "room_events"
// collection. The relation fields are plain text here, like the other test
// helpers.
func newRoomEventsTestApp(t *testing.T) core.App {
	t.Helper()
	app := newSlugTestApp(t)

	events := core.NewBaseCollection(roomEventsCollection)
	events.Fields.Add(
		&core.TextField{Name: "card"},
		&core.TextField{Name: "user"},
		&core.NumberField{Name: "count"},
		&core.DateField{Name: "joined"},
		&core.DateField{Name: "left"},
	)
	if err := app.Save(events); err != nil {
		t.Fatalf("create room_events collection: %v", err)
	}
	return app
}

func eventRows(t *testing.T, app core.App, card, user string) []*core.Record {
	t.Helper()
	rows, err := app.FindRecordsByFilter(
		roomEventsCollection, "card = {:card} && user = {:user}", "", 0, 0,
		dbx.Params{"card": card, "user": user},
	)
	if err != nil {
		t.Fatalf("list room_events: %v", err)
	}
	return rows
}

func TestUpsertRoomJoin_CountsPerCardAndUser(t *testing.T) {
	app := newRoomEventsTestApp(t)

	for i := 0; i < 2; i++ {
		if err := upsertRoomJoin(app, "alice", "card1"); err != nil {
			t.Fatalf("upsertRoomJoin: %v", err)
		}
	}
	if err := upsertRoomJoin(app, "bob", "card1"); err != nil {
		t.Fatalf("upsertRoomJoin: %v", err)
	}

	alice := eventRows(t, app, "card1", "alice")
	if len(alice) != 1 || alice[0].GetInt("count") != 2 {
		t.Fatalf("alice rows = %d, want 1 row with count 2", len(alice))
	}
	if alice[0].GetDateTime("joined").IsZero() {
		t.Error("joined was not set")
	}
	if bob := eventRows(t, app, "card1", "bob"); len(bob) != 1 || bob[0].GetInt("count") != 1 {
		t.Errorf("bob rows = %d, want 1 row with count 1", len(bob))
	}
}

func TestUpsertRoomLeave_IsIndependentOfTheJoinCount(t *testing.T) {
	app := newRoomEventsTestApp(t)

	if err := upsertRoomJoin(app, "alice", "card1"); err != nil {
		t.Fatalf("upsertRoomJoin: %v", err)
	}
	if err := upsertRoomLeave(app, "alice", "card1"); err != nil {
		t.Fatalf("upsertRoomLeave: %v", err)
	}
	// A leave without a recorded join still creates the row.
	if err := upsertRoomLeave(app, "bob", "card1"); err != nil {
		t.Fatalf("upsertRoomLeave: %v", err)
	}

	alice := eventRows(t, app, "card1", "alice")
	if len(alice) != 1 || alice[0].GetInt("count") != 1 ||
		alice[0].GetDateTime("joined").IsZero() || alice[0].GetDateTime("left").IsZero() {
		t.Errorf("alice = %v, want 1 row with count 1, joined and left set", alice)
	}
	bob := eventRows(t, app, "card1", "bob")
	if len(bob) != 1 || bob[0].GetInt("count") != 0 || bob[0].GetDateTime("left").IsZero() {
		t.Errorf("bob = %v, want 1 row with count 0 and left set", bob)
	}
}

// Regression test: a join and a leave arriving together (a reconnect after a
// token expiry) used to create the row twice or overwrite "joined" with a
// stale copy.
func TestRoomEvents_ConcurrentJoinAndLeaveKeepBoth(t *testing.T) {
	app := newRoomEventsTestApp(t)

	for i := 0; i < 20; i++ {
		card := fmt.Sprintf("card%d", i)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			if err := upsertRoomJoin(app, "alice", card); err != nil {
				t.Errorf("upsertRoomJoin: %v", err)
			}
		}()
		go func() {
			defer wg.Done()
			if err := upsertRoomLeave(app, "alice", card); err != nil {
				t.Errorf("upsertRoomLeave: %v", err)
			}
		}()
		wg.Wait()

		rows := eventRows(t, app, card, "alice")
		if len(rows) != 1 {
			t.Fatalf("%s: got %d rows, want 1", card, len(rows))
		}
		if rows[0].GetDateTime("joined").IsZero() || rows[0].GetDateTime("left").IsZero() {
			t.Errorf("%s: joined or left was lost: %v", card, rows[0])
		}
	}
}

func TestJoinTracker_DedupesWithinTheWindow(t *testing.T) {
	tracker := newJoinTracker()
	start := time.Now()

	if !tracker.shouldRecord("alice", "card1", start) {
		t.Fatal("first join was not counted")
	}
	if tracker.shouldRecord("alice", "card1", start.Add(joinDedupeWindow-time.Second)) {
		t.Error("a reconnect inside the window was counted")
	}
	if !tracker.shouldRecord("alice", "card1", start.Add(joinDedupeWindow)) {
		t.Error("a join after the window was not counted")
	}
	// Another user or another card is a different join.
	if !tracker.shouldRecord("bob", "card1", start) || !tracker.shouldRecord("alice", "card2", start) {
		t.Error("a different user or card was deduped")
	}
}

func TestJoinTracker_ForgetAllowsARetry(t *testing.T) {
	tracker := newJoinTracker()
	now := time.Now()

	tracker.shouldRecord("alice", "card1", now)
	tracker.forget("alice", "card1")
	if !tracker.shouldRecord("alice", "card1", now) {
		t.Error("a forgotten join was still deduped")
	}
}
