package serve

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/asano69/aspen/internal/slug"
)

// The fixture is shared with internal/wikilink and the frontend (see
// frontend/src/lib/models/titleDerivation.test.ts). It pins how the first
// line of a card (the candidate) becomes the card's title, following Cosense.
const titleDerivationFixturePath = "../../testdata/title-derivation.json"

type titleDerivationCase struct {
	Name      string `json:"name"`
	Candidate string `json:"candidate"`
	Title     string `json:"title"`
	// Empty marks a candidate with no usable text: its title is the fallback.
	Empty bool `json:"empty"`
}

func TestTitleDerivationFixture(t *testing.T) {
	raw, err := os.ReadFile(titleDerivationFixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var cases []titleDerivationCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	if len(cases) == 0 {
		t.Fatal("fixture has no cases")
	}

	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			got := titleBase(TitleCandidate(c.Candidate))
			if got != c.Title {
				t.Errorf("titleBase(%q) = %q, want %q", c.Candidate, got, c.Title)
			}
			// Whatever the rule, a title never starts or ends with whitespace.
			if got != strings.TrimSpace(got) {
				t.Errorf("titleBase(%q) = %q has surrounding whitespace", c.Candidate, got)
			}
		})
	}
}

func TestResolveTitle_TrailingWhitespaceIsNotADistinctTitle(t *testing.T) {
	// "A   " and "A" are the same title in Cosense, so the second card is a
	// duplicate and gets a numeric suffix.
	app := newSlugTestApp(t)
	createCard(t, app, "pod1", "A")

	got, err := resolveTitle(app, "pod1", "A   ", "")
	if err != nil {
		t.Fatalf("resolveTitle: %v", err)
	}
	if got != "A_2" {
		t.Errorf(`resolveTitle("A   ") = %q, want %q`, got, "A_2")
	}
}

func TestResolveTitle_ReservedWordWithTrailingWhitespace(t *testing.T) {
	app := newSlugTestApp(t)

	got, err := resolveTitle(app, "pod1", "new  ", "")
	if err != nil {
		t.Fatalf("resolveTitle: %v", err)
	}
	if got != "new_" {
		t.Errorf(`resolveTitle("new  ") = %q, want %q`, got, "new_")
	}
}

func TestResolveTitle_TruncationLeavesNoTrailingWhitespace(t *testing.T) {
	// The limit cuts right after the space, so the cut title must be trimmed
	// again.
	app := newSlugTestApp(t)
	candidate := TitleCandidate(strings.Repeat("あ", slug.MaxTitleRunes-1) + " い")

	got, err := resolveTitle(app, "pod1", candidate, "")
	if err != nil {
		t.Fatalf("resolveTitle: %v", err)
	}
	if want := strings.Repeat("あ", slug.MaxTitleRunes-1); string(got) != want {
		t.Errorf("title = %q, want %d \"あ\" without trailing whitespace", got, slug.MaxTitleRunes-1)
	}
}

// Regression test: the room passes the raw first line to the watcher (see
// room.save), so trailing whitespace typed by the user reaches resolve.
func TestTitleWatcherResolve_StoresTheTrimmedTitle(t *testing.T) {
	app := newSlugTestApp(t)
	card := createCard(t, app, "pod1", "tmp")

	newTitleWatcher().resolve(app, card.Id, "abc   ")

	saved, err := app.FindRecordById("cards", card.Id)
	if err != nil {
		t.Fatalf("reload card: %v", err)
	}
	if saved.GetString("title") != "abc" || saved.GetString("titleLc") != "abc" {
		t.Errorf("title = %q, titleLc = %q, want %q for both",
			saved.GetString("title"), saved.GetString("titleLc"), "abc")
	}
}
