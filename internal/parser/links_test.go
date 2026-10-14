package parser

import (
	"slices"
	"testing"
)

func TestLinksPositions(t *testing.T) {
	cases := []struct {
		name string
		text string
		want []Link
	}{
		{"plain and hashtag", testTitle + "a [page] #tag", []Link{
			{"page", false, 1, 2, 8},
			{"tag", true, 1, 9, 13},
		}},
		{"inside a decoration", testTitle + "[* [page]]", []Link{{"page", false, 1, 3, 9}}},
		{"the label of an external link is plain", testTitle + "[https://e.com [page]]", nil},
		{"inside a quote", testTitle + "> [page]", []Link{{"page", false, 1, 2, 8}}},
		{"inside a table cell", testTitle + "table:t\n\ta\t[page]", []Link{{"page", false, 2, 3, 9}}},
		{"multibyte text before the link", testTitle + "日本 [語]", []Link{{"語", false, 1, 7, 12}}},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := Parse(tt.text).Links(); !slices.Equal(got, tt.want) {
				t.Errorf("Links() = %+v, want %+v", got, tt.want)
			}
		})
	}
}
