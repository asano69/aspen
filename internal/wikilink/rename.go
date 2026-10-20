package wikilink

import (
	"slices"
	"strings"
	"unicode/utf16"

	"github.com/asano69/cardpod/internal/parser"
)

// Edit replaces Len UTF-16 code units of a card's text, starting at From, with
// Insert. Yjs counts text positions in UTF-16 code units, so the edits can be
// applied to a Y.Text as they are.
type Edit struct {
	From, Len int
	Insert    string
}

// RenameEdits returns the edits that make every wiki link and hashtag whose
// identity is oldLc (see linkKey) point at newTitle instead. The edits are
// ordered from the end of the text to its start, so applying them one after
// another never invalidates the positions of the rest.
//
// Only the title inside the notation is replaced, so decorations, labels and
// every character around the link stay as they are. The title line, code
// blocks and inline code hold no links (see the parser) and are never touched.
// A hashtag ends at a space, so the spaces of newTitle become "_", which has
// the same identity. Any other whitespace cannot be written in a hashtag, so
// then a hashtag is replaced as a whole by a bracket link.
func RenameEdits(text, oldLc, newTitle string) []Edit {
	lines := strings.Split(text, "\n")
	offsets := make([]int, len(lines)) // UTF-16 offset of each line start
	pos := 0
	for i, line := range lines {
		offsets[i] = pos
		pos += utf16Len(line) + 1
	}

	hashTag := strings.ReplaceAll(newTitle, " ", "_")
	fitsHashTag := !strings.ContainsFunc(newTitle, func(r rune) bool {
		return r != ' ' && parser.IsSpace(r)
	})
	var edits []Edit
	for _, link := range parser.Parse(text).Links() {
		if linkKey(link.Title) != oldLc {
			continue
		}
		line := lines[link.Line]
		from, to, insert := link.Start+1, link.End-1, newTitle // between "[" and "]"
		if link.HashTag {
			if fitsHashTag {
				to, insert = link.End, hashTag // after "#"
			} else {
				from, to, insert = link.Start, link.End, "["+newTitle+"]"
			}
		}
		edits = append(edits, Edit{
			From:   offsets[link.Line] + utf16Len(line[:from]),
			Len:    utf16Len(line[from:to]),
			Insert: insert,
		})
	}
	slices.SortFunc(edits, func(a, b Edit) int { return b.From - a.From })
	return edits
}

func utf16Len(s string) int {
	return len(utf16.Encode([]rune(s)))
}
