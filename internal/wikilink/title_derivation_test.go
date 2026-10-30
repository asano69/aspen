package wikilink

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/asano69/aspen/internal/slug"
)

// The fixture is shared with internal/serve (see title_derivation_test.go
// there). A link to a title must have the same identity as the card that
// title resolves to, or "[abc ]" would not reach the card "abc".
const titleDerivationFixturePath = "../../testdata/title-derivation.json"

type titleDerivationCase struct {
	Name      string `json:"name"`
	Candidate string `json:"candidate"`
	Title     string `json:"title"`
	Empty     bool   `json:"empty"`
}

func TestLinkKeyMatchesTitleDerivation(t *testing.T) {
	raw, err := os.ReadFile(titleDerivationFixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var cases []titleDerivationCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}

	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			want := slug.ToLowerKey(c.Title)
			if c.Empty {
				want = "" // no usable text: the link is dropped
			}
			if got := linkKey(c.Candidate); got != want {
				t.Errorf("linkKey(%q) = %q, want %q", c.Candidate, got, want)
			}
		})
	}
}
