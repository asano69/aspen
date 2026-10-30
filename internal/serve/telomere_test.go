package serve

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/asano69/aspen/internal/api"
	"github.com/asano69/aspen/internal/lineid"
)

func TestTelomereLines_KeepsOnlyWhatTheEditorShows(t *testing.T) {
	lines := []lineid.Line{
		{ID: "a", Updated: 5, User: "alice", Hash: "h", Key: "k", Signature: "s"},
		{ID: "b", Updated: 6},
	}
	want := []api.TelomereLine{{ID: "a", Updated: 5, User: "alice"}, {ID: "b", Updated: 6}}
	if got := telomereLines(lines); !slices.Equal(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestTelomereLines_NoLinesIsAnEmptyList(t *testing.T) {
	if got := telomereLines(nil); got == nil || len(got) != 0 {
		t.Errorf("got %#v, want an empty non-nil slice", got)
	}
}

func TestLastLeft(t *testing.T) {
	app := newRoomEventsTestApp(t)

	if got, err := lastLeft(app, "alice", "card1"); err != nil || got != 0 {
		t.Fatalf("without a record: (%d, %v), want (0, nil)", got, err)
	}
	if err := upsertRoomJoin(app, "alice", "card1"); err != nil {
		t.Fatalf("upsertRoomJoin: %v", err)
	}
	if got, err := lastLeft(app, "alice", "card1"); err != nil || got != 0 {
		t.Errorf("joined but never left: (%d, %v), want (0, nil)", got, err)
	}
	if err := upsertRoomLeave(app, "alice", "card1"); err != nil {
		t.Fatalf("upsertRoomLeave: %v", err)
	}
	if got, err := lastLeft(app, "alice", "card1"); err != nil || got == 0 {
		t.Errorf("after leaving: (%d, %v), want a time", got, err)
	}
}

func decodeLinesMessage(t *testing.T, data []byte) []api.TelomereLine {
	t.Helper()
	var msg linesMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatalf("decode %s: %v", data, err)
	}
	if msg.Type != "lines" {
		t.Fatalf("type = %q, want %q", msg.Type, "lines")
	}
	return msg.Lines
}

// The message must follow every edit: a stale cached encoding would show the
// old lines to every editor.
func TestRoom_MessageFollowsTheLines(t *testing.T) {
	app := newImportTestApp(t)
	pod := createPod(t, app, "pod1")
	card := createLinksTestCard(t, app, pod.Id, "T", "")
	m := newRooms(app)

	r, err := m.acquire(card.Id)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	defer m.release(r)

	r.Replace("T\nb")
	first := decodeLinesMessage(t, r.Message())
	if len(first) != 2 {
		t.Fatalf("got %d lines, want 2", len(first))
	}

	r.Replace("T\nb\nc")
	second := decodeLinesMessage(t, r.Message())
	if len(second) != 3 || second[0].ID != first[0].ID {
		t.Errorf("lines = %v, want 3 lines, the first keeping its ID %q", second, first[0].ID)
	}
}
