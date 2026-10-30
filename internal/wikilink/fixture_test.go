package wikilink

import (
	"encoding/json"
	"os"
	"slices"
	"testing"

	"github.com/asano69/aspen/internal/parser"
)

// The fixture is shared with the frontend (see
// frontend/src/lib/models/extractLinks.test.ts). The frontend parser is the
// reference: every expectation in it describes what the TS parser extracts.
const fixturePath = "../../testdata/link-extraction.json"

type fixtureLink struct {
	Title   string `json:"title"`
	TitleLc string `json:"titleLc"`
}

type fixtureCase struct {
	Name  string        `json:"name"`
	Text  string        `json:"text"`
	Links []fixtureLink `json:"links"`
}

// knownFailing lists the cases the Go parser does not match yet. A case that
// is listed must still fail, so the list can only shrink: when a case starts
// passing, the test asks for its removal. It is empty now.
var knownFailing = map[string]bool{}

func extractedLinks(text string) []fixtureLink {
	got := []fixtureLink{}
	for _, t := range orderedTargets(parser.Parse(text).LinkTitles()) {
		got = append(got, fixtureLink{Title: t.title, TitleLc: t.titleLc})
	}
	return got
}

func TestLinkExtractionFixture(t *testing.T) {
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var cases []fixtureCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}

	names := make(map[string]bool, len(cases))
	for _, c := range cases {
		names[c.Name] = true
	}
	for name := range knownFailing {
		if !names[name] {
			t.Errorf("knownFailing lists %q, which is not in the fixture", name)
		}
	}

	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			got := extractedLinks(c.Text)
			ok := slices.Equal(got, c.Links)
			switch {
			case knownFailing[c.Name] && ok:
				t.Errorf("now passes: remove %q from knownFailing", c.Name)
			case knownFailing[c.Name]:
				t.Logf("known failing: got %v, want %v", got, c.Links)
			case !ok:
				t.Errorf("text %q: got %v, want %v", c.Text, got, c.Links)
			}
		})
	}
}
