package serve

import (
	"fmt"
	"net/url"
	"slices"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpod/internal/replica"
)

const (
	pullT1 = "2026-01-01 00:00:01.000Z"
	pullT2 = "2026-01-01 00:00:02.000Z"
)

func mustCollection(t *testing.T, name string) replica.Collection {
	t.Helper()
	c, ok := replica.Find(name)
	if !ok {
		t.Fatalf("collection %q is not registered in internal/replica", name)
	}
	return c
}

// pullCardID returns a valid 15-character record id that sorts by n.
func pullCardID(n int) string {
	return fmt.Sprintf("card%011d", n)
}

// newPullTestApp extends newLinksTestApp with an "updated" field on every
// replicated collection. A plain text field stands in for the production
// autodate field, so tests can give several records exactly the same value.
func newPullTestApp(t *testing.T) core.App {
	t.Helper()
	app := newLinksTestApp(t)

	for _, name := range []string{"cards", "card_links", "pots"} {
		collection, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatalf("find %s collection: %v", name, err)
		}
		collection.Fields.Add(&core.TextField{Name: "updated"})
		if err := app.Save(collection); err != nil {
			t.Fatalf("extend %s collection: %v", name, err)
		}
	}
	return app
}

func createPullCard(t *testing.T, app core.App, pot string, n int, updated string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("cards")
	if err != nil {
		t.Fatalf("find cards collection: %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("id", pullCardID(n))
	record.Set("pot", pot)
	record.Set("title", pullCardID(n))
	record.Set("titleLc", pullCardID(n))
	record.Set("updated", updated)
	if err := app.Save(record); err != nil {
		t.Fatalf("save card: %v", err)
	}
	return record
}

// pullFixture creates, in pot "pot1": card 3 (updated later), card 1 and
// card 2 (same "updated", card 2 soft-deleted); and card 9 in another pot.
// Card 3 is created first so the expected order can't come from insertion
// order.
func pullFixture(t *testing.T) core.App {
	t.Helper()
	app := newPullTestApp(t)
	createPullCard(t, app, "pot1", 3, pullT2)
	createPullCard(t, app, "pot1", 1, pullT1)
	softDelete(t, app, createPullCard(t, app, "pot1", 2, pullT1))
	createPullCard(t, app, "pot2", 9, pullT1)
	return app
}

func pulledIDs(t *testing.T, app core.App, after *checkpoint, limit int) []string {
	t.Helper()
	records, err := pullRecords(app, mustCollection(t, "cards"), "pot1", after, limit)
	if err != nil {
		t.Fatalf("pullRecords: %v", err)
	}
	ids := make([]string, len(records))
	for i, record := range records {
		ids[i] = record.Id
	}
	return ids
}

func TestPullRecords_OrdersByUpdatedThenIDAndKeepsDeleted(t *testing.T) {
	app := pullFixture(t)

	got := pulledIDs(t, app, nil, 100)
	want := []string{pullCardID(1), pullCardID(2), pullCardID(3)}
	if !slices.Equal(got, want) {
		t.Errorf("ids = %v, want %v", got, want)
	}
}

func TestPullRecords_ContinuesAfterCheckpoint(t *testing.T) {
	app := pullFixture(t)

	cases := []struct {
		name  string
		after checkpoint
		want  []string
	}{
		// Cards 1 and 2 share the same "updated": the id decides.
		{"tie on updated, before the last of the tie", checkpoint{pullT1, pullCardID(1)}, []string{pullCardID(2), pullCardID(3)}},
		{"tie on updated, at the last of the tie", checkpoint{pullT1, pullCardID(2)}, []string{pullCardID(3)}},
		{"at the newest card", checkpoint{pullT2, pullCardID(3)}, nil},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := pulledIDs(t, app, &tt.after, 100); !slices.Equal(got, tt.want) {
				t.Errorf("ids = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestPullRecords_RespectsLimit(t *testing.T) {
	app := pullFixture(t)

	got := pulledIDs(t, app, nil, 2)
	want := []string{pullCardID(1), pullCardID(2)}
	if !slices.Equal(got, want) {
		t.Errorf("ids = %v, want %v", got, want)
	}
}

func TestPullRecords_FiltersByTheCollectionsPotField(t *testing.T) {
	// card_links belongs to a pot through "target_pot", not "pot".
	app := newPullTestApp(t)
	createLink(t, app, "src1", "pot1", "A")
	createLink(t, app, "src2", "pot2", "B")

	records, err := pullRecords(app, mustCollection(t, "card_links"), "pot1", nil, 100)
	if err != nil {
		t.Fatalf("pullRecords: %v", err)
	}
	if len(records) != 1 || records[0].GetString("target_title") != "A" {
		t.Errorf("got %d records, want only the link to A", len(records))
	}
}

func TestPullRecords_GlobalCollectionReturnsEveryRecord(t *testing.T) {
	// pots has no pot field: the pot id of the request is ignored.
	app := newPullTestApp(t)
	createPot(t, app, "a")
	createPot(t, app, "b")

	records, err := pullRecords(app, mustCollection(t, "pots"), "", nil, 100)
	if err != nil {
		t.Fatalf("pullRecords: %v", err)
	}
	if len(records) != 2 {
		t.Errorf("got %d records, want 2", len(records))
	}
}

func TestParsePullQuery(t *testing.T) {
	valid := []struct {
		query string
		after *checkpoint
		limit int
	}{
		{"", nil, defaultPullLimit},
		{"limit=5", nil, 5},
		{"updatedAt=x&id=y&limit=1000", &checkpoint{"x", "y"}, maxPullLimit},
	}
	for _, tt := range valid {
		q, _ := url.ParseQuery(tt.query)
		after, limit, err := parsePullQuery(q)
		if err != nil {
			t.Errorf("parsePullQuery(%q): %v", tt.query, err)
			continue
		}
		sameCheckpoint := (after == nil) == (tt.after == nil) && (after == nil || *after == *tt.after)
		if !sameCheckpoint || limit != tt.limit {
			t.Errorf("parsePullQuery(%q) = (%v, %d), want (%v, %d)", tt.query, after, limit, tt.after, tt.limit)
		}
	}

	for _, query := range []string{"limit=0", "limit=1001", "limit=abc", "updatedAt=x", "id=y"} {
		q, _ := url.ParseQuery(query)
		if _, _, err := parsePullQuery(q); err == nil {
			t.Errorf("parsePullQuery(%q) succeeded, want an error", query)
		}
	}
}
