package serve

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/asano69/cardpod/internal/slug"
)

func TestResolveTitle_LongCandidateIsTruncated(t *testing.T) {
	app := newSlugTestApp(t)

	got, err := resolveTitle(app, "pod1", TitleCandidate(strings.Repeat("あ", 300)), "")
	if err != nil {
		t.Fatalf("resolveTitle: %v", err)
	}
	if want := strings.Repeat("あ", slug.MaxTitleRunes); string(got) != want {
		t.Errorf("title has %d runes, want %d", utf8.RuneCountInString(string(got)), slug.MaxTitleRunes)
	}
}

// Regression test: a suffix appended to a maximum-length title used to push
// it over the limit, and a suffix cut off by the limit made the title
// collide forever.
func TestResolveTitle_LongCollisionsKeepTheirSuffix(t *testing.T) {
	app := newSlugTestApp(t)
	long := TitleCandidate(strings.Repeat("あ", 300))

	seen := map[string]bool{}
	var last string
	// 105 cards cover the 1-, 2- and 3-digit suffixes ("_2" .. "_105").
	for i := 0; i < 105; i++ {
		card := saveResolvedCard(t, app, "pod1", long, nil)
		title, titleLc := card.GetString("title"), card.GetString("titleLc")
		if n := utf8.RuneCountInString(title); n > slug.MaxTitleRunes {
			t.Fatalf("card %d: title has %d runes, want at most %d", i+1, n, slug.MaxTitleRunes)
		}
		if seen[titleLc] {
			t.Fatalf("card %d: titleLc is not unique", i+1)
		}
		seen[titleLc] = true
		last = title
	}

	if !strings.HasSuffix(last, "_105") || utf8.RuneCountInString(last) != slug.MaxTitleRunes {
		t.Errorf("last title = %d runes ending %q, want %d runes ending %q",
			utf8.RuneCountInString(last), last[len(last)-6:], slug.MaxTitleRunes, "_105")
	}
}
