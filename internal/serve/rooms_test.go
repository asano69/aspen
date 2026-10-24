package serve

import "testing"

const roomTestText = "Hello World\nbody"

// Releasing the last editor of a card must leave its text in the card's
// content row.
func TestRooms_ReleaseStoresTheText(t *testing.T) {
	app := newImportTestApp(t)
	pot := createPot(t, app, "pot1")
	card := createLinksTestCard(t, app, pot.Id, "Hello World", "")
	m := newRooms(app)

	r, err := m.acquire(card.Id)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	r.Replace(roomTestText)
	m.release(r)

	if got := cardText(t, app, card.Id); got != roomTestText {
		t.Errorf("stored text = %q, want %q", got, roomTestText)
	}
}

// Opening a card again must start from what the content row holds.
func TestRooms_AcquireLoadsTheNoteFile(t *testing.T) {
	app := newImportTestApp(t)
	pot := createPot(t, app, "pot1")
	card := createLinksTestCard(t, app, pot.Id, "Hello World", "")
	m := newRooms(app)

	first, err := m.acquire(card.Id)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	first.Replace(roomTestText)
	m.release(first)

	second, err := m.acquire(card.Id)
	if err != nil {
		t.Fatalf("acquire again: %v", err)
	}
	defer m.release(second)
	if got := second.Text(); got != roomTestText {
		t.Errorf("reopened text = %q, want %q", got, roomTestText)
	}
}
