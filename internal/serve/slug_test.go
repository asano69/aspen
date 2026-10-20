// Regression tests for the merge alert: a card is reported as a duplicate
// when its resolved title differs from the base title its header asks for,
// because another live card of the same pot already holds that base title.
package serve

import (
	"slices"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpod/internal/slug"
)

// newSlugTestApp boots a throwaway PocketBase app with just the "cards"
// collection the title tests touch, so they don't depend on the full
// production schema (see migrations/*_collections_snapshot.go).
func newSlugTestApp(t *testing.T) core.App {
	t.Helper()

	app := core.NewBaseApp(core.BaseAppConfig{DataDir: t.TempDir()})
	if err := app.Bootstrap(); err != nil {
		t.Fatalf("bootstrap app: %v", err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })

	cards := core.NewBaseCollection("cards")
	cards.Fields.Add(
		&core.TextField{Name: "pot"},
		&core.TextField{Name: "title"},
		// titleLc backs resolveUniqueTitleInPot's collision check (see
		// slug.go) -- a real column is needed here to query against,
		// mirroring the production schema.
		&core.TextField{Name: "titleLc"},
		// Soft-delete marker (see notDeleted in cards.go).
		&core.DateField{Name: "deleted"},
	)
	if err := app.Save(cards); err != nil {
		t.Fatalf("create cards collection: %v", err)
	}
	return app
}

// createCard inserts a "cards" record and returns it.
func createCard(t *testing.T, app core.App, pot, title string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("cards")
	if err != nil {
		t.Fatalf("find cards collection: %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("pot", pot)
	record.Set("title", title)
	// Mirrors production: titleLc is always derived from title (see
	// internal/slug.ToLowerKey), never entered independently.
	record.Set("titleLc", slug.ToLowerKey(title))
	if err := app.Save(record); err != nil {
		t.Fatalf("save card: %v", err)
	}
	return record
}

// softDelete marks record as deleted the way the frontend does.
func softDelete(t *testing.T, app core.App, record *core.Record) {
	t.Helper()
	record.Set("deleted", "2026-01-01 00:00:00.000Z")
	if err := app.Save(record); err != nil {
		t.Fatalf("soft-delete card: %v", err)
	}
}

func TestFindMergeTarget_CollisionReturnsTheExistingTitle(t *testing.T) {
	app := newSlugTestApp(t)
	createCard(t, app, "pot1", "p")
	dup := createCard(t, app, "pot1", "p_2")

	got, err := findMergeTarget(app, "pot1", "p", "p_2", dup.Id)
	if err != nil {
		t.Fatalf("findMergeTarget: %v", err)
	}
	if got != "p" {
		t.Errorf("mergeTarget = %q, want %q", got, "p")
	}
}

func TestFindMergeTarget_NoCollision_NoAlert(t *testing.T) {
	app := newSlugTestApp(t)
	self := createCard(t, app, "pot1", "p")

	got, err := findMergeTarget(app, "pot1", "p", "p", self.Id)
	if err != nil {
		t.Fatalf("findMergeTarget: %v", err)
	}
	if got != "" {
		t.Errorf("mergeTarget = %q, want empty", got)
	}
}

func TestFindMergeTarget_TypedSuffixIsNotADuplicate(t *testing.T) {
	// Regression test: the old rule looked at the "_<number>" suffix of the
	// resolved title, so a card the user deliberately titled "p_2" was
	// reported as a duplicate of "p".
	app := newSlugTestApp(t)
	createCard(t, app, "pot1", "p")
	self := createCard(t, app, "pot1", "p_2")

	got, err := findMergeTarget(app, "pot1", "p_2", "p_2", self.Id)
	if err != nil {
		t.Fatalf("findMergeTarget: %v", err)
	}
	if got != "" {
		t.Errorf("mergeTarget = %q, want empty", got)
	}
}

func TestFindMergeTarget_MatchesByTitleLc(t *testing.T) {
	// "a_b" collides with "a b" (same titleLc), so the alert names the
	// card as it is spelled.
	app := newSlugTestApp(t)
	createCard(t, app, "pot1", "a b")
	dup := createCard(t, app, "pot1", "a_b_2")

	got, err := findMergeTarget(app, "pot1", "a_b", "a_b_2", dup.Id)
	if err != nil {
		t.Fatalf("findMergeTarget: %v", err)
	}
	if got != "a b" {
		t.Errorf("mergeTarget = %q, want %q", got, "a b")
	}
}

func TestFindMergeTarget_DeletedOriginal_NoAlert(t *testing.T) {
	app := newSlugTestApp(t)
	softDelete(t, app, createCard(t, app, "pot1", "p"))
	dup := createCard(t, app, "pot1", "p_2")

	got, err := findMergeTarget(app, "pot1", "p", "p_2", dup.Id)
	if err != nil {
		t.Fatalf("findMergeTarget: %v", err)
	}
	if got != "" {
		t.Errorf("mergeTarget = %q, want empty (original is deleted)", got)
	}
}

func TestFindMergeTarget_OtherPot_NoAlert(t *testing.T) {
	app := newSlugTestApp(t)
	createCard(t, app, "pot2", "p")
	dup := createCard(t, app, "pot1", "p_2")

	got, err := findMergeTarget(app, "pot1", "p", "p_2", dup.Id)
	if err != nil {
		t.Fatalf("findMergeTarget: %v", err)
	}
	if got != "" {
		t.Errorf("mergeTarget = %q, want empty (different pot)", got)
	}
}

func TestTitleWatcherAlert_NotifiesTheTargetAndThenClears(t *testing.T) {
	app := newSlugTestApp(t)
	createCard(t, app, "pot1", "p")
	dup := createCard(t, app, "pot1", "p_2")

	var got []string
	w := newTitleWatcher()
	w.notify = func(cardID, target string) error {
		got = append(got, cardID+"/"+target)
		return nil
	}

	w.alert(app, "pot1", dup.Id, "p", "p_2")   // duplicate
	w.alert(app, "pot1", dup.Id, "p_2", "p_2") // renamed: no longer a duplicate

	want := []string{dup.Id + "/p", dup.Id + "/"}
	if !slices.Equal(got, want) {
		t.Errorf("notifications = %q, want %q", got, want)
	}
}
