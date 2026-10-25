package serve

import (
	"testing"

	"github.com/asano69/cardpod/internal/lineid"
)

func TestTelomereLines_Unread(t *testing.T) {
	lines := []lineid.Line{
		{Updated: 5, User: "alice"}, // someone else, after I left
		{Updated: 5, User: "bob"},   // my own edit
		{Updated: 5, User: ""},      // no known author
		{Updated: 1, User: "alice"}, // someone else, before I left
	}
	got := telomereLines(lines, "bob", 3)

	want := []bool{true, false, false, false}
	for i, w := range want {
		if got[i].Unread != w {
			t.Errorf("line %d: unread = %v, want %v", i, got[i].Unread, w)
		}
	}
	if got[0].Updated != 5 || got[0].User != "alice" {
		t.Errorf("line 0 = %+v, want updated 5 by alice", got[0])
	}
}

func TestTelomereLines_NoLinesIsAnEmptyList(t *testing.T) {
	if got := telomereLines(nil, "bob", 0); got == nil || len(got) != 0 {
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
