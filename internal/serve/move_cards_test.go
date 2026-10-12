package serve

import "testing"

func TestMoveCards_CopiesToTheTargetPotAndDeletesTheOriginal(t *testing.T) {
	app := newImportTestApp(t)
	src := createPot(t, app, "src")
	dst := createPot(t, app, "dst")
	runImport(t, app, "src", `{"pages":[
		{"title":"a","lines":["a","see [x]"]},
		{"title":"b","lines":["b"]}
	]}`)
	runImport(t, app, "dst", `{"pages":[{"title":"a","lines":["a","other"]}]}`)
	yjsServer = nil // no room is loaded: every card is read from its stored log

	a := cardInPot(t, app, src.Id, "a")
	b := cardInPot(t, app, src.Id, "b")
	moved, err := moveCards(app, []string{a.Id, b.Id, "missing", a.Id}, dst.Id)
	if err != nil {
		t.Fatalf("moveCards: %v", err)
	}
	if moved != 2 {
		t.Errorf("moved = %d, want 2 (a missing id and a repeated id are skipped)", moved)
	}

	for _, id := range []string{a.Id, b.Id} {
		old, err := app.FindRecordById("cards", id)
		if err != nil {
			t.Fatalf("reload card: %v", err)
		}
		if old.GetDateTime("deleted").IsZero() {
			t.Errorf("card %s was not soft-deleted", id)
		}
	}

	// "a" collides with the card already in dst, so the copy is suffixed.
	movedA := cardInPot(t, app, dst.Id, "a_2")
	if got := cardText(t, app, movedA.Id); got != "a\nsee [x]" {
		t.Errorf("text = %q, want %q", got, "a\nsee [x]")
	}
	if got, want := movedA.GetString("description"), `["see [x]"]`; got != want {
		t.Errorf("description = %q, want %q", got, want)
	}
	links, err := ownTargetTitleLcs(app, movedA.Id)
	if err != nil {
		t.Fatalf("ownTargetTitleLcs: %v", err)
	}
	if len(links) != 1 || links[0] != "x" {
		t.Errorf("links = %v, want [x]", links)
	}
	if got := cardText(t, app, cardInPot(t, app, dst.Id, "a").Id); got != "a\nother" {
		t.Errorf("the existing card changed: %q", got)
	}

	// The first id is listed first on screen, i.e. has the higher position.
	movedB := cardInPot(t, app, dst.Id, "b")
	if movedA.GetFloat("position") <= movedB.GetFloat("position") {
		t.Errorf("positions = %v, %v; want the first id above the second",
			movedA.GetFloat("position"), movedB.GetFloat("position"))
	}
}

func TestMoveCards_SkipsCardsAlreadyInThePot(t *testing.T) {
	app := newImportTestApp(t)
	pot := createPot(t, app, "src")
	runImport(t, app, "src", `{"pages":[{"title":"a","lines":["a"]}]}`)
	yjsServer = nil

	moved, err := moveCards(app, []string{cardInPot(t, app, pot.Id, "a").Id}, pot.Id)
	if err != nil {
		t.Fatalf("moveCards: %v", err)
	}
	if moved != 0 {
		t.Errorf("moved = %d, want 0", moved)
	}
}
