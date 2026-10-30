// Package lineid keeps a stable ID for every line of a card's text. The IDs
// are updated while an edit is applied, so they always match the text.
//
// An edit replaces the lines it touches by the lines it produces. One of the
// touched lines keeps its ID on one of the produced lines; every other
// produced line gets a fresh ID, and the other touched IDs are gone for good.
// IDs are UUIDs version 7, so a gone ID is never handed out again.
//
//   - Normally the first touched line keeps its ID on the first produced line:
//     Enter at the end of a line, joining lines, typing.
//   - If the edit starts at a line start and leaves text after it (or touches
//     several lines), the last touched line keeps its ID on the last produced
//     line: Enter at the start of a line, deleting whole lines.
package lineid

import (
	"slices"

	"github.com/asano69/cardpod/internal/cmgo/ot"
	"github.com/google/uuid"
)

const newline = '\n'

// newID returns the ID for a new line. Tests replace it to get predictable IDs.
var newID = func() string { return uuid.Must(uuid.NewV7()).String() }

// Line is the metadata of one line. Apply leaves the lines it produces
// unsigned; the signer (see internal/linesign) fills in the rest.
type Line struct {
	ID        string `json:"id"`        // UUID version 7
	Hash      string `json:"hash"`      // SHA-256 of the line text, hex
	Updated   int64  `json:"updated"`   // Unix time of the last edit that touched the line
	User      string `json:"user"`      // email address of the user who made that edit; empty if unknown
	Key       string `json:"key"`       // public key of the server that signed the line
	Signature string `json:"signature"` // of ID, Hash, Updated, User and Key, by the server
}

// Count returns the number of lines of doc. There is always at least one.
func Count(doc []uint16) int { return newlines(doc) + 1 }

func newlines(units []uint16) int {
	n := 0
	for _, u := range units {
		if u == newline {
			n++
		}
	}
	return n
}

// New returns n lines with fresh IDs.
func New(n int, now int64) []Line {
	lines := make([]Line, n)
	for i := range lines {
		lines[i] = Line{ID: newID(), Updated: now}
	}
	return lines
}

// Apply returns the lines after edits were applied to doc. The edits must be
// sorted and must not overlap, with positions in doc. lines is not modified.
// If lines does not fit doc, every line gets a fresh ID first.
func Apply(lines []Line, doc []uint16, edits []ot.Edit, now int64) []Line {
	if len(lines) != Count(doc) {
		lines = New(Count(doc), now)
	}
	lines = slices.Clone(lines)
	// Last edit first, so that the line indexes of the earlier ones stay valid.
	for n := len(edits) - 1; n >= 0; n-- {
		lines = applyEdit(lines, doc, edits[n], now)
	}
	return lines
}

func applyEdit(lines []Line, doc []uint16, e ot.Edit, now int64) []Line {
	first := newlines(doc[:e.From])
	last := first + newlines(doc[e.From:e.To])
	atLineStart := e.From == 0 || doc[e.From-1] == newline
	atLineEnd := e.To == len(doc) || doc[e.To] == newline
	produced := newlines(e.Text) + 1

	// The ID that stays, and the produced line that keeps it.
	survivor, slot := lines[first].ID, 0
	if atLineStart && (first < last || !atLineEnd) {
		survivor, slot = lines[last].ID, produced-1
	}

	fresh := make([]Line, produced)
	for n := range fresh {
		id := survivor
		if n != slot {
			id = newID()
		}
		fresh[n] = Line{ID: id, Updated: now}
	}
	return slices.Replace(lines, first, last+1, fresh...)
}
