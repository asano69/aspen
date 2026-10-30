// contents.go keeps the full text of every card in the "card_contents"
// collection, one row per card, together with the ID of every line of it (the
// "lines" field, see internal/lineid). The row is the only stored copy of the
// text: no editing history is kept. While a card is open, its live copy is a
// collab server held by rooms.go, which writes the row a moment after each
// edit.
//
// A row is bound to the card's id, not to its title, so renaming or
// soft-deleting a card never moves or removes its text.
package serve

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/asano69/aspen/internal/lineid"
)

const contentsCollection = "card_contents"

// findContent returns the content row of a card, or sql.ErrNoRows.
func findContent(app core.App, cardID string) (*core.Record, error) {
	return app.FindFirstRecordByFilter(
		contentsCollection, "card = {:card}", dbx.Params{"card": cardID},
	)
}

// readNote returns the stored text of card, or "" when it has no row yet.
func readNote(app core.App, card *core.Record) (string, error) {
	record, err := findContent(app, card.Id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read the text of card %s: %w", card.Id, err)
	}
	return record.GetString("text"), nil
}

// readLines returns the stored line IDs of card, or nil when it has none yet.
func readLines(app core.App, card *core.Record) ([]lineid.Line, error) {
	record, err := findContent(app, card.Id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read the lines of card %s: %w", card.Id, err)
	}
	return storedLines(record), nil
}

// storedLines decodes the "lines" field of a content row. A missing or invalid
// value gives nil.
func storedLines(record *core.Record) []lineid.Line {
	var lines []lineid.Line
	if err := json.Unmarshal([]byte(record.GetString("lines")), &lines); err != nil {
		return nil
	}
	return lines
}

// fitLines returns lines when there is one per line of text, and fresh lines
// otherwise.
func fitLines(lines []lineid.Line, text string) []lineid.Line {
	n := strings.Count(text, "\n") + 1
	if len(lines) == n {
		return lines
	}
	return lineid.New(n, time.Now().Unix())
}

// writeNote stores text and its line IDs as the content of card, creating the
// row on the first write. nil lines mean "keep the stored ones". Lines that do
// not fit the text are renewed. Unchanged content is not written again, so
// "updated" is not bumped.
func writeNote(app core.App, card *core.Record, text string, lines []lineid.Line) error {
	record, err := findContent(app, card.Id)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		collection, err := app.FindCachedCollectionByNameOrId(contentsCollection)
		if err != nil {
			return err
		}
		record = core.NewRecord(collection)
		record.Set("card", card.Id)
		record.Set("pod", card.GetString("pod"))
	case err != nil:
		return fmt.Errorf("find the text of card %s: %w", card.Id, err)
	}

	if lines == nil {
		lines = storedLines(record)
	}
	encoded, err := json.Marshal(fitLines(lines, text))
	if err != nil {
		return fmt.Errorf("encode the lines of card %s: %w", card.Id, err)
	}
	// GetString on a JSON field returns its raw JSON text.
	if record.GetString("text") == text && record.GetString("lines") == string(encoded) {
		return nil
	}

	record.Set("text", text)
	record.Set("lines", types.JSONRaw(encoded))
	if err := app.Save(record); err != nil {
		return fmt.Errorf("save the text of card %s: %w", card.Id, err)
	}
	return nil
}

// persistNote stores text and its line IDs as the note of a card and brings
// the data derived from it (preview, links, search index) up to date. nil
// lines keep the stored ones (see writeNote). A card that no longer exists or
// is deleted is ignored.
func persistNote(app core.App, cardID, text string, lines []lineid.Line) error {
	card, err := app.FindRecordById("cards", cardID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if !card.GetDateTime("deleted").IsZero() {
		return nil
	}
	if err := writeNote(app, card, text, lines); err != nil {
		return err
	}
	return syncDerived(app, cardID, text)
}
