package serve

import (
	"slices"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/aspen/internal/api"
	"github.com/asano69/aspen/internal/slug"
)

// newLinksTestApp boots a throwaway app with the collections
// links1HopHandler touches: pods, cards, and card_links.
func newLinksTestApp(t *testing.T) core.App {
	t.Helper()

	app := core.NewBaseApp(core.BaseAppConfig{DataDir: t.TempDir()})
	if err := app.Bootstrap(); err != nil {
		t.Fatalf("bootstrap app: %v", err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })

	pods := core.NewBaseCollection("pods")
	pods.Fields.Add(&core.TextField{Name: "name"}, &core.DateField{Name: "deleted"})
	if err := app.Save(pods); err != nil {
		t.Fatalf("create pods collection: %v", err)
	}

	cards := core.NewBaseCollection("cards")
	cards.Fields.Add(
		&core.TextField{Name: "pod"},
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
		&core.TextField{Name: "target_pod"},
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

func createPod(t *testing.T, app core.App, name string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("pods")
	if err != nil {
		t.Fatalf("find pods collection: %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("name", name)
	if err := app.Save(record); err != nil {
		t.Fatalf("save pod: %v", err)
	}
	return record
}

func createLinksTestCard(t *testing.T, app core.App, pod, title, description string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("cards")
	if err != nil {
		t.Fatalf("find cards collection: %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("pod", pod)
	record.Set("title", title)
	record.Set("titleLc", slug.ToLowerKey(title))
	// Stored the same way production stores it (see updatePreview).
	record.Set("description", descriptionLines("T\n"+description))
	if err := app.Save(record); err != nil {
		t.Fatalf("save card: %v", err)
	}
	return record
}

func createLink(t *testing.T, app core.App, source, targetPod, targetTitle string) {
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
	record.Set("target_pod", targetPod)
	record.Set("target_title", targetTitle)
	record.Set("target_titleLc", slug.ToLowerKey(targetTitle))
	if err := app.Save(record); err != nil {
		t.Fatalf("save card_links: %v", err)
	}
}

func TestFindCardBySlug(t *testing.T) {
	app := newLinksTestApp(t)
	pod := createPod(t, app, "pod1")
	card := createLinksTestCard(t, app, pod.Id, "Hello World", "")

	got, err := findCardBySlug(app, pod.Id, "Hello_World")
	if err != nil {
		t.Fatalf("findCardBySlug: %v", err)
	}
	if got == nil || got.Id != card.Id {
		t.Errorf("findCardBySlug = %v, want %v", got, card.Id)
	}

	if got, err := findCardBySlug(app, pod.Id, "missing"); err != nil || got != nil {
		t.Errorf("findCardBySlug(missing) = (%v, %v), want (nil, nil)", got, err)
	}
}

func TestFindCardBySlug_IgnoresDeletedCard(t *testing.T) {
	app := newLinksTestApp(t)
	pod := createPod(t, app, "pod1")
	softDelete(t, app, createLinksTestCard(t, app, pod.Id, "Hello", ""))

	if got, err := findCardBySlug(app, pod.Id, "Hello"); err != nil || got != nil {
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
	pod := createPod(t, app, "pod1")

	center := createLinksTestCard(t, app, pod.Id, "Center", "center desc")
	out := createLinksTestCard(t, app, pod.Id, "OutTarget", "out desc")
	in := createLinksTestCard(t, app, pod.Id, "InSource", "in desc")

	// Center links out to OutTarget and to a page that doesn't exist yet.
	createLink(t, app, center.Id, pod.Id, "OutTarget")
	createLink(t, app, center.Id, pod.Id, "Ghost")
	// InSource links in to Center; OutTarget has a link of its own.
	createLink(t, app, in.Id, pod.Id, "Center")
	createLink(t, app, out.Id, pod.Id, "Other")

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
	pod := createPod(t, app, "pod1")

	source := createLinksTestCard(t, app, pod.Id, "Source", "")
	createLink(t, app, source.Id, pod.Id, "Ghost")

	ghost, err := absentCard(app, pod.Id, "Ghost")
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
	pod := createPod(t, app, "pod1")

	center := createLinksTestCard(t, app, pod.Id, "Center", "")
	outTarget := createLinksTestCard(t, app, pod.Id, "OutTarget", "")
	inSource := createLinksTestCard(t, app, pod.Id, "InSource", "")
	createLink(t, app, center.Id, pod.Id, "OutTarget")
	createLink(t, app, inSource.Id, pod.Id, "Center")
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
	pod := createPod(t, app, "pod1")

	center := createLinksTestCard(t, app, pod.Id, "Center", "")
	createLinksTestCard(t, app, pod.Id, "OutTarget", "")
	createLink(t, app, center.Id, pod.Id, "OutTarget")
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

func TestLinks1Hop_ExcludesSelfAndCardsOfOtherPods(t *testing.T) {
	app := newLinksTestApp(t)
	pod := createPod(t, app, "pod1")
	otherPod := createPod(t, app, "pod2")

	center := createLinksTestCard(t, app, pod.Id, "Center", "")
	createLinksTestCard(t, app, otherPod.Id, "Same", "")
	createLink(t, app, center.Id, pod.Id, "Center")
	createLink(t, app, center.Id, pod.Id, "Same") // "Same" exists only in pod2

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
	pod := createPod(t, app, "pod1")
	otherPod := createPod(t, app, "pod2")

	a := createLinksTestCard(t, app, pod.Id, "A", "")
	b := createLinksTestCard(t, app, pod.Id, "B", "")
	c := createLinksTestCard(t, app, pod.Id, "C", "")
	d := createLinksTestCard(t, app, pod.Id, "D", "")
	e := createLinksTestCard(t, app, otherPod.Id, "E", "")

	// X does not exist as a card: sharing the target is enough.
	createLink(t, app, a.Id, pod.Id, "X")
	createLink(t, app, b.Id, pod.Id, "X")
	createLink(t, app, c.Id, pod.Id, "Y")      // different target
	createLink(t, app, d.Id, pod.Id, "X")      // deleted below
	createLink(t, app, e.Id, otherPod.Id, "X") // same title, other pod
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
	pod := createPod(t, app, "pod1")

	a := createLinksTestCard(t, app, pod.Id, "A", "")
	b := createLinksTestCard(t, app, pod.Id, "B", "")
	c := createLinksTestCard(t, app, pod.Id, "C", "")

	// B shares target X with A, but A also links to B directly (1 hop).
	createLink(t, app, a.Id, pod.Id, "X")
	createLink(t, app, a.Id, pod.Id, "B")
	createLink(t, app, b.Id, pod.Id, "X")
	createLink(t, app, c.Id, pod.Id, "X")

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
	pod := createPod(t, app, "pod1")

	a := createLinksTestCard(t, app, pod.Id, "A", "")
	b := createLinksTestCard(t, app, pod.Id, "B", "")
	c := createLinksTestCard(t, app, pod.Id, "C", "")

	createLink(t, app, a.Id, pod.Id, "X")
	createLink(t, app, a.Id, pod.Id, "Y")
	createLink(t, app, a.Id, pod.Id, "Z") // nobody else links to Z
	createLink(t, app, b.Id, pod.Id, "X")
	createLink(t, app, b.Id, pod.Id, "Y") // B shares X and Y, but is listed under X only
	createLink(t, app, c.Id, pod.Id, "Y")

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
	pod := createPod(t, app, "pod1")

	a := createLinksTestCard(t, app, pod.Id, "A", "")
	b := createLinksTestCard(t, app, pod.Id, "B", "")

	// A links Y before X, while B links X before Y: only A's order counts.
	createLink(t, app, a.Id, pod.Id, "Y")
	createLink(t, app, a.Id, pod.Id, "X")
	createLink(t, app, b.Id, pod.Id, "X")
	createLink(t, app, b.Id, pod.Id, "Y")

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
	pod := createPod(t, app, "pod1")
	a := createLinksTestCard(t, app, pod.Id, "A", "")

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
	pod := createPod(t, app, "pod1")
	a := createLinksTestCard(t, app, pod.Id, "A", "")
	createLink(t, app, a.Id, pod.Id, "B")
	createLink(t, app, a.Id, pod.Id, "C")

	got, err := ownTargetTitleLcs(app, a.Id)
	if err != nil {
		t.Fatalf("ownTargetTitleLcs: %v", err)
	}
	if len(got) != 2 {
		t.Errorf("ownTargetTitleLcs = %v, want 2 entries", got)
	}
}
