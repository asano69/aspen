package serve

import (
	"encoding/json"
	"os"
	"slices"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpod/internal/slug"
)

// The fixture is shared with the frontend (see docs/architecture/related-cards-offline.md).
// Unlike testdata/link-extraction.json, the reference here is this package:
// links1Hop and links2Hop are the existing behavior, and the frontend's
// Dexie-based derivation has to match them.
//
// Fixture rules, which the frontend loader must follow too:
//   - Cards live in pod "p1" unless "pod" says otherwise. The open card is
//     always looked up in p1.
//   - "links" lists the link targets of a card in order of first appearance,
//     without duplicates by titleLc (wikilink.Sync keeps one row per titleLc).
//   - A deleted card is soft-deleted, and in production its links are marked
//     deleted too (see link_cleanup.go). A replica therefore holds neither the
//     card nor its links.
//   - "open" is a title. It may have no card (a page that does not exist yet).
//   - "oneHop" is the titles of the 1 hop cards, in order. "twoHop" is the
//     rows of the 2 hop view, in order, with the title of the shared target.
const linkGraphFixturePath = "../../testdata/link-graph.json"

const defaultGraphPod = "p1"

type graphCard struct {
	Title   string   `json:"title"`
	Pod     string   `json:"pod"`
	Deleted bool     `json:"deleted"`
	Links   []string `json:"links"`
}

type graphHop struct {
	Via   string `json:"via"`
	Title string `json:"title"`
}

type graphCase struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Cards       []graphCard `json:"cards"`
	Open        string      `json:"open"`
	OneHop      []string    `json:"oneHop"`
	TwoHop      []graphHop  `json:"twoHop"`
}

// buildLinkGraph stores the cards and links of a case and returns a lookup
// from a pod name ("" means the default pod) to its id.
func buildLinkGraph(t *testing.T, app core.App, cards []graphCard) func(string) string {
	t.Helper()

	pods := map[string]string{}
	podID := func(name string) string {
		if name == "" {
			name = defaultGraphPod
		}
		if id, ok := pods[name]; ok {
			return id
		}
		id := createPod(t, app, name).Id
		pods[name] = id
		return id
	}
	podID("") // the open card is looked up in the default pod

	records := make([]*core.Record, len(cards))
	for i, c := range cards {
		records[i] = createLinksTestCard(t, app, podID(c.Pod), c.Title, "")
	}
	for i, c := range cards {
		seen := make(map[string]bool, len(c.Links))
		for _, target := range c.Links {
			lc := slug.ToLowerKey(target)
			if seen[lc] {
				t.Fatalf("card %q links to titleLc %q twice", c.Title, lc)
			}
			seen[lc] = true
			createLink(t, app, records[i].Id, podID(c.Pod), target)
		}
	}
	for i, c := range cards {
		if c.Deleted {
			softDelete(t, app, records[i])
		}
	}
	return podID
}

// openCard finds the open card the way relatedCardsHandler does, falling back
// to a stand-in for a page that does not exist yet.
func openCard(t *testing.T, app core.App, pod, title string) *core.Record {
	t.Helper()

	target := slug.FromTitle(title)
	card, err := findCardBySlug(app, pod, target)
	if err == nil && card == nil {
		card, err = absentCard(app, pod, target)
	}
	if err != nil {
		t.Fatalf("open card %q: %v", title, err)
	}
	return card
}

func TestLinkGraphFixture(t *testing.T) {
	raw, err := os.ReadFile(linkGraphFixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var cases []graphCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}

	names := make(map[string]bool, len(cases))
	for _, c := range cases {
		if names[c.Name] {
			t.Fatalf("duplicate case name %q", c.Name)
		}
		names[c.Name] = true
	}
	if len(cases) == 0 {
		t.Fatal("fixture has no cases")
	}

	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			app := newLinksTestApp(t)
			podID := buildLinkGraph(t, app, c.Cards)
			card := openCard(t, app, podID(""), c.Open)

			oneHop, err := links1Hop(app, card)
			if err != nil {
				t.Fatalf("links1Hop: %v", err)
			}
			if got := linkedTitles(oneHop); !slices.Equal(got, c.OneHop) {
				t.Errorf("oneHop = %q, want %q", got, c.OneHop)
			}

			twoHop, err := links2Hop(app, card)
			if err != nil {
				t.Fatalf("links2Hop: %v", err)
			}
			want := make([]string, len(c.TwoHop))
			for i, hop := range c.TwoHop {
				want[i] = hop.Via + "/" + hop.Title
			}
			if got := hopRows(twoHop); !slices.Equal(got, want) {
				t.Errorf("twoHop = %q, want %q", got, want)
			}
		})
	}
}
