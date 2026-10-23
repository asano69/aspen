package serve

import (
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// newImportTestApp extends newLinksTestApp with what Import touches beyond
// it: the cards' image field. A note is a file in the app's data directory.
func newImportTestApp(t *testing.T) core.App {
	t.Helper()
	app := newLinksTestApp(t)

	cards, err := app.FindCollectionByNameOrId("cards")
	if err != nil {
		t.Fatalf("find cards collection: %v", err)
	}
	cards.Fields.Add(&core.TextField{Name: "image"})
	if err := app.Save(cards); err != nil {
		t.Fatalf("extend cards collection: %v", err)
	}
	return app
}

func runImport(t *testing.T, app core.App, pot, json string) ImportResult {
	t.Helper()
	result, err := Import(app, pot, strings.NewReader(json), nil)
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	return result
}

// cardText reads the note file of a card.
func cardText(t *testing.T, app core.App, cardID string) string {
	t.Helper()
	card, err := app.FindRecordById("cards", cardID)
	if err != nil {
		t.Fatalf("find card: %v", err)
	}
	text, err := readNote(app, card)
	if err != nil {
		t.Fatalf("readNote: %v", err)
	}
	return text
}

func cardInPot(t *testing.T, app core.App, pot, titleLc string) *core.Record {
	t.Helper()
	card, err := app.FindFirstRecordByFilter(
		"cards", "pot = {:pot} && titleLc = {:titleLc}",
		dbx.Params{"pot": pot, "titleLc": titleLc},
	)
	if err != nil {
		t.Fatalf("find card %q: %v", titleLc, err)
	}
	return card
}

// parsePages indexes a JSON export and reads every page back, like Import does.
func parsePages(data string) ([]importPage, error) {
	r := strings.NewReader(data)
	spans, err := indexPages(r)
	if err != nil {
		return nil, err
	}
	pages := make([]importPage, len(spans))
	for i, span := range spans {
		if pages[i], err = readPage(r, span); err != nil {
			return nil, err
		}
	}
	return pages, nil
}

func TestIndexPages(t *testing.T) {
	// Several pages, a field before and after "pages", and varied spacing
	// around the commas: each span must read back as its own page.
	pages, err := parsePages(`{"name":"x", "pages":[ {"title":"  a  ","lines":["a"]} ,
		{"title":"b"},{"title":"c"}],"other":1}`)
	if err != nil {
		t.Fatalf("parsePages: %v", err)
	}
	var titles []string
	for _, p := range pages {
		titles = append(titles, p.Title)
	}
	if want := []string{"a", "b", "c"}; !slices.Equal(titles, want) {
		t.Errorf("titles = %q, want %q", titles, want)
	}

	if pages, err := parsePages(`{}`); err != nil || len(pages) != 0 {
		t.Errorf(`parsePages("{}") = (%v, %v), want no pages`, pages, err)
	}

	for _, bad := range []string{`not json`, `[]`, `{"pages":[{"title":"  ","lines":[]}]}`} {
		if _, err := parsePages(bad); err == nil {
			t.Errorf("parsePages(%q) succeeded, want an error", bad)
		}
	}
}

func TestIndexPages_ObjectLines(t *testing.T) {
	pages, err := parsePages(`{
		"name": "x",
		"pages": [{"title": "a", "id": "1", "lines": [
			{"text": "a", "created": 1, "userId": "u"},
			{"text": "line2", "updated": 2}
		]}]
	}`)
	if err != nil {
		t.Fatalf("parsePages: %v", err)
	}
	if got := pageText(pages[0]); got != "a\nline2" {
		t.Errorf("pageText = %q, want %q", got, "a\nline2")
	}

	// A mix of both formats is accepted too.
	pages, err = parsePages(`{"pages":[{"title":"a","lines":["a",{"text":"b"}]}]}`)
	if err != nil {
		t.Fatalf("parsePages (mixed): %v", err)
	}
	if got := pageText(pages[0]); got != "a\nb" {
		t.Errorf("pageText (mixed) = %q, want %q", got, "a\nb")
	}

	for _, bad := range []string{
		`{"pages":[{"title":"a","lines":[{"created":1}]}]}`,
		`{"pages":[{"title":"a","lines":[1]}]}`,
	} {
		if _, err := parsePages(bad); err == nil {
			t.Errorf("parsePages(%q) succeeded, want an error", bad)
		}
	}
}

func TestImport_CreatesCardsInFileOrder(t *testing.T) {
	app := newImportTestApp(t)
	pot := createPot(t, app, "pot1")

	result := runImport(t, app, "pot1", `{"pages":[
		{"title":"page1title","lines":["page1title","line2","line3"]},
		{"title":"page2title","lines":["page2title"]}
	]}`)
	if result != (ImportResult{Created: 2}) {
		t.Errorf("result = %+v, want 2 created", result)
	}

	first := cardInPot(t, app, pot.Id, "page1title")
	cardInPot(t, app, pot.Id, "page2title")
	if got := cardText(t, app, first.Id); got != "page1title\nline2\nline3" {
		t.Errorf("first card text = %q", got)
	}
	if got := first.GetString("description"); got != `["line2","line3"]` {
		t.Errorf("first card description = %q", got)
	}
}

func TestImport_OverwritesCardWithSameTitle(t *testing.T) {
	app := newImportTestApp(t)
	pot := createPot(t, app, "pot1")

	runImport(t, app, "pot1", `{"pages":[{"title":"a","lines":["a","😀 old"]}]}`)
	before := cardInPot(t, app, pot.Id, "a")

	result := runImport(t, app, "pot1", `{"pages":[{"title":"A","lines":["A","new [link]"]}]}`)
	if result != (ImportResult{Overwritten: 1}) {
		t.Errorf("result = %+v, want 1 overwritten", result)
	}

	after := cardInPot(t, app, pot.Id, "a")
	if after.Id != before.Id {
		t.Errorf("card id changed: %s -> %s", before.Id, after.Id)
	}
	if got := cardText(t, app, after.Id); got != "A\nnew [link]" {
		t.Errorf("text = %q, want %q", got, "A\nnew [link]")
	}
	if got, want := after.GetString("description"), `["new [link]"]`; got != want {
		t.Errorf("description = %q, want %q", got, want)
	}
	links, err := ownTargetTitleLcs(app, after.Id)
	if err != nil {
		t.Fatalf("ownTargetTitleLcs: %v", err)
	}
	if len(links) != 1 || links[0] != "link" {
		t.Errorf("links = %v, want [link]", links)
	}

	cards, err := app.FindRecordsByFilter("cards", "pot = {:pot}", "", 0, 0, dbx.Params{"pot": pot.Id})
	if err != nil {
		t.Fatalf("list cards: %v", err)
	}
	if len(cards) != 1 {
		t.Errorf("got %d cards, want 1", len(cards))
	}
}

func TestImport_TitleWithBackslashIsOverwritten(t *testing.T) {
	// Regression test: a title holding a backslash was altered when written
	// into a filter string, so the existing card was not found and the second
	// import failed with "titleLc: Value must be unique".
	app := newImportTestApp(t)
	createPot(t, app, "pot1")
	const file = "{\"pages\":[{\"title\":\"\\\\`abdu'l-bahá\",\"lines\":[\"x\"]}]}"

	if got := runImport(t, app, "pot1", file); got != (ImportResult{Created: 1}) {
		t.Fatalf("first import = %+v, want 1 created", got)
	}
	if got := runImport(t, app, "pot1", file); got != (ImportResult{Overwritten: 1}) {
		t.Errorf("second import = %+v, want 1 overwritten", got)
	}
}

func TestImport_LaterDuplicateInFileWins(t *testing.T) {
	app := newImportTestApp(t)
	pot := createPot(t, app, "pot1")

	// Pages are imported in reverse, so the file's last "a" lands first and
	// the earlier one overwrites it.
	result := runImport(t, app, "pot1", `{"pages":[
		{"title":"a","lines":["a","first"]},
		{"title":"a","lines":["a","second"]}
	]}`)
	if result != (ImportResult{Created: 1, Overwritten: 1}) {
		t.Errorf("result = %+v, want 1 created and 1 overwritten", result)
	}
	if got := cardText(t, app, cardInPot(t, app, pot.Id, "a").Id); got != "a\nfirst" {
		t.Errorf("text = %q, want %q", got, "a\nfirst")
	}
}

func TestImport_IgnoresDeletedCardWithSameTitle(t *testing.T) {
	app := newImportTestApp(t)
	pot := createPot(t, app, "pot1")

	runImport(t, app, "pot1", `{"pages":[{"title":"a","lines":["a","old"]}]}`)
	softDelete(t, app, cardInPot(t, app, pot.Id, "a"))

	result := runImport(t, app, "pot1", `{"pages":[{"title":"a","lines":["a","new"]}]}`)
	if result != (ImportResult{Created: 1}) {
		t.Errorf("result = %+v, want 1 created", result)
	}

	live, err := app.FindRecordsByFilter(
		"cards", "pot = {:pot} && "+notDeleted, "", 0, 0, dbx.Params{"pot": pot.Id},
	)
	if err != nil {
		t.Fatalf("list live cards: %v", err)
	}
	if len(live) != 1 {
		t.Fatalf("got %d live cards, want 1", len(live))
	}
	if got := cardText(t, app, live[0].Id); got != "a\nnew" {
		t.Errorf("text = %q, want %q", got, "a\nnew")
	}
}

func TestImport_ReportsProgress(t *testing.T) {
	app := newImportTestApp(t)
	createPot(t, app, "pot1")

	var got [][2]int
	_, err := Import(app, "pot1", strings.NewReader(`{"pages":[
		{"title":"a","lines":["a"]},
		{"title":"b","lines":["b"]}
	]}`), func(done, total int) { got = append(got, [2]int{done, total}) })
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if want := [][2]int{{1, 2}, {2, 2}}; !slices.Equal(got, want) {
		t.Errorf("progress = %v, want %v", got, want)
	}
}

func TestImport_UnknownPot(t *testing.T) {
	app := newImportTestApp(t)

	_, err := Import(app, "missing", strings.NewReader(`{"pages":[]}`), nil)
	if err == nil || !strings.Contains(err.Error(), `pot "missing" not found`) {
		t.Errorf("err = %v, want a pot-not-found error", err)
	}
}
