package serve

import (
	"os"
	"testing"
)

const roomTestText = "Hello World\nbody"

// Releasing the last editor of a card must leave its text in the note file
// named after the card's pot and titleLc.
func TestRooms_ReleaseWritesTheNoteFile(t *testing.T) {
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

	data, err := os.ReadFile(notePath(app, pot.Id, "hello_world"))
	if err != nil {
		t.Fatalf("read note file: %v", err)
	}
	if string(data) != roomTestText {
		t.Errorf("note file = %q, want %q", data, roomTestText)
	}
}

// Opening a card again must start from what the note file holds.
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
