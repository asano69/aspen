package serve

import "testing"

// The text of a card must survive a rename: the row follows the card's id.
func TestContents_FollowTheCardAcrossARename(t *testing.T) {
	app := newImportTestApp(t)
	pot := createPot(t, app, "pot1")
	card := createLinksTestCard(t, app, pot.Id, "Old", "")

	if err := persistNote(app, card.Id, "Old\nbody"); err != nil {
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
	pot := createPot(t, app, "pot1")
	card := createLinksTestCard(t, app, pot.Id, "A", "")

	for range 2 {
		if err := persistNote(app, card.Id, "A\nbody"); err != nil {
			t.Fatalf("persistNote: %v", err)
		}
	}
	n, err := app.CountRecords("card_contents")
	if err != nil || n != 1 {
		t.Errorf("card_contents rows = %d (err %v), want 1", n, err)
	}
}
