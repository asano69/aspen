// contents.go keeps the full text of every card in the "card_contents"
// collection, one row per card. The row is the only stored copy of the text:
// no editing history is kept. While a card is open, its live copy is a collab
// server held by rooms.go, which writes the row a moment after each edit.
//
// A row is bound to the card's id, not to its title, so renaming or
// soft-deleting a card never moves or removes its text.
package serve

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
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

// writeNote stores text as the content of card, creating the row on the first
// write. An unchanged text is not written again, so "updated" is not bumped.
func writeNote(app core.App, card *core.Record, text string) error {
	record, err := findContent(app, card.Id)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		collection, err := app.FindCachedCollectionByNameOrId(contentsCollection)
		if err != nil {
			return err
		}
		record = core.NewRecord(collection)
		record.Set("card", card.Id)
		record.Set("pot", card.GetString("pot"))
	case err != nil:
		return fmt.Errorf("find the text of card %s: %w", card.Id, err)
	case record.GetString("text") == text:
		return nil
	}

	record.Set("text", text)
	if err := app.Save(record); err != nil {
		return fmt.Errorf("save the text of card %s: %w", card.Id, err)
	}
	return nil
}

// persistNote stores text as the note of a card and brings the data derived
// from it (preview, links, search index) up to date. A card that no longer
// exists or is deleted is ignored.
func persistNote(app core.App, cardID, text string) error {
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
	if err := writeNote(app, card, text); err != nil {
		return err
	}
	return syncDerived(app, cardID, text)
}
