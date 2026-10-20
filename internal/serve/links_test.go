package serve

import (
	"slices"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpod/internal/api"
	"github.com/asano69/cardpod/internal/slug"
)

// newLinksTestApp boots a throwaway app with the collections
// links1HopHandler touches: pots, cards, and card_links.
func newLinksTestApp(t *testing.T) core.App {
	t.Helper()

	app := core.NewBaseApp(core.BaseAppConfig{DataDir: t.TempDir()})
	if err := app.Bootstrap(); err != nil {
		t.Fatalf("bootstrap app: %v", err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })

	pots := core.NewBaseCollection("pots")
	pots.Fields.Add(&core.TextField{Name: "name"})
	if err := app.Save(pots); err != nil {
		t.Fatalf("create pots collection: %v", err)
	}

	cards := core.NewBaseCollection("cards")
	cards.Fields.Add(
		&core.TextField{Name: "pot"},
		&core.TextField{Name: "title"},
		&core.TextField{Name: "titleLc"},
		&core.JSONField{Name: "description"},
		&core.DateField{Name: "deleted"},
	)
	if err := app.Save(cards); err != nil {
		t.Fatalf("create cards collection: %v", err)
	}

	links := core.NewBaseCollection("card_links")
	links.Fields.Add(
		&core.TextField{Name: "source"},
		&core.TextField{Name: "target_pot"},
		&core.TextField{Name: "target_title"},
		&core.TextField{Name: "target_titleLc"},
		&core.NumberField{Name: "position"},
		&core.DateField{Name: "deleted"},
	)
	if err := app.Save(links); err != nil {
		t.Fatalf("create card_links collection: %v", err)
	}

	return app
}

func createPot(t *testing.T, app core.App, name string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("pots")
	if err != nil {
		t.Fatalf("find pots collection: %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("name", name)
	if err := app.Save(record); err != nil {
		t.Fatalf("save pot: %v", err)
	}
	return record
}

func createLinksTestCard(t *testing.T, app core.App, pot, title, description string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("cards")
	if err != nil {
		t.Fatalf("find cards collection: %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("pot", pot)
	record.Set("title", title)
	record.Set("titleLc", slug.ToLowerKey(title))
	// Stored the same way production stores it (see updatePreview).
	record.Set("description", descriptionLines("T\n"+description))
	if err := app.Save(record); err != nil {
		t.Fatalf("save card: %v", err)
	}
	return record
}

func createLink(t *testing.T, app core.App, source, targetPot, targetTitle string) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("card_links")
	if err != nil {
		t.Fatalf("find card_links collection: %v", err)
	}
	// Like wikilink.Sync, number a source's links in the order they are
	// created, so tests can rely on link order.
	position, err := app.CountRecords("card_links", dbx.HashExp{"source": source})
	if err != nil {
		t.Fatalf("count card_links: %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("source", source)
	record.Set("position", position)
	record.Set("target_pot", targetPot)
	record.Set("target_title", targetTitle)
	record.Set("target_titleLc", slug.ToLowerKey(targetTitle))
	if err := app.Save(record); err != nil {
		t.Fatalf("save card_links: %v", err)
	}
}

func TestFindCardBySlug(t *testing.T) {
	app := newLinksTestApp(t)
	pot := createPot(t, app, "pot1")
	card := createLinksTestCard(t, app, pot.Id, "Hello World", "")

	got, err := findCardBySlug(app, pot.Id, "Hello_World")
	if err != nil {
		t.Fatalf("findCardBySlug: %v", err)
	}
	if got == nil || got.Id != card.Id {
		t.Errorf("findCardBySlug = %v, want %v", got, card.Id)
	}

	if got, err := findCardBySlug(app, pot.Id, "missing"); err != nil || got != nil {
		t.Errorf("findCardBySlug(missing) = (%v, %v), want (nil, nil)", got, err)
	}
}

func TestFindCardBySlug_IgnoresDeletedCard(t *testing.T) {
	app := newLinksTestApp(t)
	pot := createPot(t, app, "pot1")
	softDelete(t, app, createLinksTestCard(t, app, pot.Id, "Hello", ""))

	if got, err := findCardBySlug(app, pot.Id, "Hello"); err != nil || got != nil {
		t.Errorf("findCardBySlug = (%v, %v), want (nil, nil)", got, err)
	}
}

// hopRows renders links2hop rows as "via/title" for compact assertions.
func hopRows(rows []api.Link2HopCard) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.ViaTitle + "/" + string(r.Title)
	}
	return out
}

func linkedTitles(cards []linkedCard) []string {
	titles := make([]string, len(cards))
	for i, c := range cards {
		titles[i] = string(c.Title)
	}
	return titles
}

func TestLinks1Hop_MergesOutgoingAndIncoming(t *testing.T) {
	app := newLinksTestApp(t)
	pot := createPot(t, app, "pot1")

	center := createLinksTestCard(t, app, pot.Id, "Center", "center desc")
	out := createLinksTestCard(t, app, pot.Id, "OutTarget", "out desc")
	in := createLinksTestCard(t, app, pot.Id, "InSource", "in desc")

	// Center links out to OutTarget and to a page that doesn't exist yet.
	createLink(t, app, center.Id, pot.Id, "OutTarget")
	createLink(t, app, center.Id, pot.Id, "Ghost")
	// InSource links in to Center; OutTarget has a link of its own.
	createLink(t, app, in.Id, pot.Id, "Center")
	createLink(t, app, out.Id, pot.Id, "Other")

	got, err := links1Hop(app, center)
	if err != nil {
		t.Fatalf("links1Hop: %v", err)
	}

	if want := []string{"InSource", "OutTarget"}; !slices.Equal(linkedTitles(got), want) {
		t.Fatalf("titles = %v, want %v (Ghost must be excluded)", linkedTitles(got), want)
	}
	if string(got[1].Description) != `["out desc"]` || !slices.Equal(got[1].TargetTitleLc, []string{"other"}) {
		t.Errorf("OutTarget = %+v, want its description and its own link target", got[1])
	}
	if got[0].ID != in.Id || got[1].ID != out.Id {
		t.Errorf("ids = %q, %q; want %q, %q", got[0].ID, got[1].ID, in.Id, out.Id)
	}
	if got[0].TargetTitleLc == nil {
		t.Error("TargetTitleLc must be an empty list, not nil")
	}
}

func TestLinks1Hop_CardThatDoesNotExistYet(t *testing.T) {
	// A page that has not been created yet can still have incoming links.
	app := newLinksTestApp(t)
	pot := createPot(t, app, "pot1")

	source := createLinksTestCard(t, app, pot.Id, "Source", "")
	createLink(t, app, source.Id, pot.Id, "Ghost")

	ghost, err := absentCard(app, pot.Id, "Ghost")
	if err != nil {
		t.Fatalf("absentCard: %v", err)
	}

	got, err := links1Hop(app, ghost)
	if err != nil {
		t.Fatalf("links1Hop: %v", err)
	}
	if want := []string{"Source"}; !slices.Equal(linkedTitles(got), want) {
		t.Errorf("titles = %v, want %v", linkedTitles(got), want)
	}

	hops, err := links2Hop(app, ghost)
	if err != nil {
		t.Fatalf("links2Hop: %v", err)
	}
	if len(hops) != 0 {
		t.Errorf("got %d 2-hop rows, want 0: %v", len(hops), hops)
	}
}

func TestLinks1Hop_ExcludesDeletedCards(t *testing.T) {
	app := newLinksTestApp(t)
	pot := createPot(t, app, "pot1")

	center := createLinksTestCard(t, app, pot.Id, "Center", "")
	outTarget := createLinksTestCard(t, app, pot.Id, "OutTarget", "")
	inSource := createLinksTestCard(t, app, pot.Id, "InSource", "")
	createLink(t, app, center.Id, pot.Id, "OutTarget")
	createLink(t, app, inSource.Id, pot.Id, "Center")
	softDelete(t, app, outTarget)
	softDelete(t, app, inSource)

	got, err := links1Hop(app, center)
	if err != nil {
		t.Fatalf("links1Hop: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %d linked cards, want 0 (both are deleted): %v", len(got), got)
	}
}

func TestLinks1Hop_IgnoresDeletedLinks(t *testing.T) {
	app := newLinksTestApp(t)
	pot := createPot(t, app, "pot1")

	center := createLinksTestCard(t, app, pot.Id, "Center", "")
	createLinksTestCard(t, app, pot.Id, "OutTarget", "")
	createLink(t, app, center.Id, pot.Id, "OutTarget")
	link, err := app.FindFirstRecordByFilter("card_links", "source = {:id}", map[string]any{"id": center.Id})
	if err != nil {
		t.Fatalf("find link: %v", err)
	}
	softDelete(t, app, link)

	got, err := links1Hop(app, center)
	if err != nil {
		t.Fatalf("links1Hop: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %d linked cards, want 0 (the link is deleted): %v", len(got), got)
	}
}

func TestLinks1Hop_ExcludesSelfAndCardsOfOtherPots(t *testing.T) {
	app := newLinksTestApp(t)
	pot := createPot(t, app, "pot1")
	otherPot := createPot(t, app, "pot2")

	center := createLinksTestCard(t, app, pot.Id, "Center", "")
	createLinksTestCard(t, app, otherPot.Id, "Same", "")
	createLink(t, app, center.Id, pot.Id, "Center")
	createLink(t, app, center.Id, pot.Id, "Same") // "Same" exists only in pot2

	got, err := links1Hop(app, center)
	if err != nil {
		t.Fatalf("links1Hop: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %d linked cards, want 0: %v", len(got), got)
	}
}

func TestLinks2Hop_SharedTarget(t *testing.T) {
	app := newLinksTestApp(t)
	pot := createPot(t, app, "pot1")
	otherPot := createPot(t, app, "pot2")

	a := createLinksTestCard(t, app, pot.Id, "A", "")
	b := createLinksTestCard(t, app, pot.Id, "B", "")
	c := createLinksTestCard(t, app, pot.Id, "C", "")
	d := createLinksTestCard(t, app, pot.Id, "D", "")
	e := createLinksTestCard(t, app, otherPot.Id, "E", "")

	// X does not exist as a card: sharing the target is enough.
	createLink(t, app, a.Id, pot.Id, "X")
	createLink(t, app, b.Id, pot.Id, "X")
	createLink(t, app, c.Id, pot.Id, "Y")      // different target
	createLink(t, app, d.Id, pot.Id, "X")      // deleted below
	createLink(t, app, e.Id, otherPot.Id, "X") // same title, other pot
	softDelete(t, app, d)

	got, err := links2Hop(app, a)
	if err != nil {
		t.Fatalf("links2Hop: %v", err)
	}
	if want := []string{"X/B"}; !slices.Equal(hopRows(got), want) {
		t.Errorf("rows = %v, want %v", hopRows(got), want)
	}
	if got[0].ID != b.Id {
		t.Errorf("id = %q, want %q", got[0].ID, b.Id)
	}
}

func TestLinks2Hop_ExcludesCardsAlreadyOneHopAway(t *testing.T) {
	app := newLinksTestApp(t)
	pot := createPot(t, app, "pot1")

	a := createLinksTestCard(t, app, pot.Id, "A", "")
	b := createLinksTestCard(t, app, pot.Id, "B", "")
	c := createLinksTestCard(t, app, pot.Id, "C", "")

	// B shares target X with A, but A also links to B directly (1 hop).
	createLink(t, app, a.Id, pot.Id, "X")
	createLink(t, app, a.Id, pot.Id, "B")
	createLink(t, app, b.Id, pot.Id, "X")
	createLink(t, app, c.Id, pot.Id, "X")

	got, err := links2Hop(app, a)
	if err != nil {
		t.Fatalf("links2Hop: %v", err)
	}
	if want := []string{"X/C"}; !slices.Equal(hopRows(got), want) {
		t.Errorf("rows = %v, want %v (B is 1 hop away)", hopRows(got), want)
	}
}

func TestLinks2Hop_GroupsByEachSharedTarget(t *testing.T) {
	app := newLinksTestApp(t)
	pot := createPot(t, app, "pot1")

	a := createLinksTestCard(t, app, pot.Id, "A", "")
	b := createLinksTestCard(t, app, pot.Id, "B", "")
	c := createLinksTestCard(t, app, pot.Id, "C", "")

	createLink(t, app, a.Id, pot.Id, "X")
	createLink(t, app, a.Id, pot.Id, "Y")
	createLink(t, app, a.Id, pot.Id, "Z") // nobody else links to Z
	createLink(t, app, b.Id, pot.Id, "X")
	createLink(t, app, b.Id, pot.Id, "Y") // B shares X and Y, but is listed under X only
	createLink(t, app, c.Id, pot.Id, "Y")

	got, err := links2Hop(app, a)
	if err != nil {
		t.Fatalf("links2Hop: %v", err)
	}
	// B appears once, under X (the first shared target in A); Z has no row;
	// rows follow A's link order.
	if want := []string{"X/B", "Y/C"}; !slices.Equal(hopRows(got), want) {
		t.Errorf("rows = %v, want %v", hopRows(got), want)
	}
}

func TestLinks2Hop_CardIsListedUnderTheFirstSharedTargetOfTheOpenCard(t *testing.T) {
	app := newLinksTestApp(t)
	pot := createPot(t, app, "pot1")

	a := createLinksTestCard(t, app, pot.Id, "A", "")
	b := createLinksTestCard(t, app, pot.Id, "B", "")

	// A links Y before X, while B links X before Y: only A's order counts.
	createLink(t, app, a.Id, pot.Id, "Y")
	createLink(t, app, a.Id, pot.Id, "X")
	createLink(t, app, b.Id, pot.Id, "X")
	createLink(t, app, b.Id, pot.Id, "Y")

	got, err := links2Hop(app, a)
	if err != nil {
		t.Fatalf("links2Hop: %v", err)
	}
	if want := []string{"Y/B"}; !slices.Equal(hopRows(got), want) {
		t.Errorf("rows = %v, want %v", hopRows(got), want)
	}
}

func TestLinks2Hop_NoLinksMeansNoRelatedCards(t *testing.T) {
	app := newLinksTestApp(t)
	pot := createPot(t, app, "pot1")
	a := createLinksTestCard(t, app, pot.Id, "A", "")

	got, err := links2Hop(app, a)
	if err != nil {
		t.Fatalf("links2Hop: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %d linked cards, want 0: %v", len(got), got)
	}
}

func TestOwnTargetTitleLcs(t *testing.T) {
	app := newLinksTestApp(t)
	pot := createPot(t, app, "pot1")
	a := createLinksTestCard(t, app, pot.Id, "A", "")
	createLink(t, app, a.Id, pot.Id, "B")
	createLink(t, app, a.Id, pot.Id, "C")

	got, err := ownTargetTitleLcs(app, a.Id)
	if err != nil {
		t.Fatalf("ownTargetTitleLcs: %v", err)
	}
	if len(got) != 2 {
		t.Errorf("ownTargetTitleLcs = %v, want 2 entries", got)
	}
}
