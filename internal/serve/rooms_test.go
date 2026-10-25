package serve

import "testing"

const roomTestText = "Hello World\nbody"

// Releasing the last editor of a card must leave its text in the card's
// content row.
func TestRooms_ReleaseStoresTheText(t *testing.T) {
	app := newImportTestApp(t)
	pod := createPod(t, app, "pod1")
	card := createLinksTestCard(t, app, pod.Id, "Hello World", "")
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

// Line IDs are stored with the text, and an edit made after reopening keeps
// the IDs of the lines it did not touch.
func TestRooms_LineIDsSurviveReopen(t *testing.T) {
	app := newImportTestApp(t)
	pod := createPod(t, app, "pod1")
	card := createLinksTestCard(t, app, pod.Id, "T", "")
	m := newRooms(app)

	first, err := m.acquire(card.Id)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	first.Replace("T\nb")
	m.release(first)
	ids := storedLineIDs(t, app, card.Id)
	if len(ids) != 2 {
		t.Fatalf("got %d line IDs, want 2", len(ids))
	}

	second, err := m.acquire(card.Id)
	if err != nil {
		t.Fatalf("acquire again: %v", err)
	}
	second.Replace("T\nb\nc") // a line appended at the end
	m.release(second)

	got := storedLineIDs(t, app, card.Id)
	if len(got) != 3 || got[0] != ids[0] || got[1] != ids[1] {
		t.Errorf("IDs = %v, want the first two to stay %v", got, ids)
	}
}

// Opening a card again must start from what the content row holds.
func TestRooms_AcquireLoadsTheNoteFile(t *testing.T) {
	app := newImportTestApp(t)
	pod := createPod(t, app, "pod1")
	card := createLinksTestCard(t, app, pod.Id, "Hello World", "")
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
