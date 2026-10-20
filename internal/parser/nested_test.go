package parser

import (
	"encoding/json"
	"os"
	"slices"
	"testing"
)

// The fixture is shared with the frontend (see
// frontend/src/features/noteEditor/parser/cardpod/nestedBrackets.test.ts).
const nestedFixturePath = "../../testdata/nested-brackets.json"

type nestedCase struct {
	Name  string   `json:"name"`
	Text  string   `json:"text"`
	Nodes []string `json:"nodes"`
}

// inlineNodes returns the top-level inline nodes of a one-line body as
// "kind:source".
func inlineNodes(text string) []string {
	line := Parse(testTitle + text).Nodes[1] // Nodes[0] is the title
	got := []string{}
	for _, n := range line.Children {
		got = append(got, string(n.Kind)+":"+text[n.Start:n.End])
	}
	return got
}

func TestNestedBracketsFixture(t *testing.T) {
	raw, err := os.ReadFile(nestedFixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var cases []nestedCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	if len(cases) == 0 {
		t.Fatal("fixture has no cases")
	}

	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			if got := inlineNodes(c.Text); !slices.Equal(got, c.Nodes) {
				t.Errorf("%q: got %q, want %q", c.Text, got, c.Nodes)
			}
		})
	}
}
