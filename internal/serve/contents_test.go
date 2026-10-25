package serve

import (
	"slices"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// The text of a card must survive a rename: the row follows the card's id.
func TestContents_FollowTheCardAcrossARename(t *testing.T) {
	app := newImportTestApp(t)
	pod := createPod(t, app, "pod1")
	card := createLinksTestCard(t, app, pod.Id, "Old", "")

	if err := persistNote(app, card.Id, "Old\nbody", nil); err != nil {
		t.Fatalf("persistNote: %v", err)
	}
	card.Set("title", "New")
	card.Set("titleLc", "new")
	if err := app.Save(card); err != nil {
		t.Fatalf("rename card: %v", err)
	}

	if got := cardText(t, app, card.Id); got != "Old\nbody" {
		t.Errorf("text after rename = %q, want %q", got, "Old\nbody")
	}
}

// Saving the same text again must not touch the row.
func TestContents_UnchangedTextIsNotWrittenAgain(t *testing.T) {
	app := newImportTestApp(t)
	pod := createPod(t, app, "pod1")
	card := createLinksTestCard(t, app, pod.Id, "A", "")

	for range 2 {
		if err := persistNote(app, card.Id, "A\nbody", nil); err != nil {
			t.Fatalf("persistNote: %v", err)
		}
	}
	n, err := app.CountRecords("card_contents")
	if err != nil || n != 1 {
		t.Errorf("card_contents rows = %d (err %v), want 1", n, err)
	}
}

// storedLineIDs reads the stored line IDs of a card.
func storedLineIDs(t *testing.T, app core.App, cardID string) []string {
	t.Helper()
	record, err := findContent(app, cardID)
	if err != nil {
		t.Fatalf("findContent: %v", err)
	}
	var ids []string
	for _, l := range storedLines(record) {
		ids = append(ids, l.ID)
	}
	return ids
}

// Writers that know no line IDs must keep the stored ones while the line
// count is unchanged, and renew them when it is not.
func TestContents_NilLinesKeepTheStoredIDsWhileTheyFit(t *testing.T) {
	app := newImportTestApp(t)
	pod := createPod(t, app, "pod1")
	card := createLinksTestCard(t, app, pod.Id, "A", "")

	if err := persistNote(app, card.Id, "A\nb", nil); err != nil {
		t.Fatalf("persistNote: %v", err)
	}
	first := storedLineIDs(t, app, card.Id)
	if len(first) != 2 {
		t.Fatalf("got %d line IDs, want 2", len(first))
	}

	if err := persistNote(app, card.Id, "A\nc", nil); err != nil {
		t.Fatalf("persistNote: %v", err)
	}
	if got := storedLineIDs(t, app, card.Id); !slices.Equal(got, first) {
		t.Errorf("same line count: IDs = %v, want %v", got, first)
	}

	if err := persistNote(app, card.Id, "A\nc\nd", nil); err != nil {
		t.Fatalf("persistNote: %v", err)
	}
	if got := storedLineIDs(t, app, card.Id); len(got) != 3 || slices.Contains(got, first[0]) {
		t.Errorf("new line count: IDs = %v, want 3 fresh IDs", got)
	}
}
