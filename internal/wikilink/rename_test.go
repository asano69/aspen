package wikilink

import (
	"testing"
	"unicode/utf16"
)

// applyEdits applies edits (ordered from the end) to text in UTF-16 units, like
// a Y.Text would.
func applyEdits(text string, edits []Edit) string {
	units := utf16.Encode([]rune(text))
	for _, e := range edits {
		tail := append(utf16.Encode([]rune(e.Insert)), units[e.From+e.Len:]...)
		units = append(units[:e.From], tail...)
	}
	return string(utf16.Decode(units))
}

func TestRenameEdits(t *testing.T) {
	cases := []struct {
		name, text, oldLc, newTitle, want string
	}{
		{"wiki link and hashtag", "T\n[Old Title] and #old_title [x]", "old_title", "New Name",
			"T\n[New Name] and #New_Name [x]"},
		{"every occurrence", "T\n[old] [Old]\n\t[OLD]", "old", "n",
			"T\n[n] [n]\n\t[n]"},
		{"decoration keeps its markup and a label is plain", "T\n[* #old] [https://e.com [old]]", "old", "n",
			"T\n[* #n] [https://e.com [old]]"},
		{"quote and table cell", "T\n> [old]\ntable:t\n\ta\t[old]", "old", "n",
			"T\n> [n]\ntable:t\n\ta\t[n]"},
		{"title line, inline code and code blocks are skipped",
			"[old]\n`[old]`\ncode:x\n\t[old]\n[old]", "old", "n",
			"[old]\n`[old]`\ncode:x\n\t[old]\n[n]"},
		{"UTF-16 positions after an emoji", "T\n😀 [old] 日本 #old", "old", "n",
			"T\n😀 [n] 日本 #n"},
		{"other links stay", "T\n[other] [old_x]", "old", "n", "T\n[other] [old_x]"},
		{"a hashtag becomes a bracket link when the title has other whitespace",
			"T\n#old and [old]", "old", "New\u3000Name",
			"T\n[New\u3000Name] and [New\u3000Name]"},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			got := applyEdits(tt.text, RenameEdits(tt.text, tt.oldLc, tt.newTitle))
			if got != tt.want {
				t.Errorf("result = %q, want %q", got, tt.want)
			}
		})
	}
}
