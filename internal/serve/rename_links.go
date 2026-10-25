// rename_links.go rewrites the links of other cards after a card was renamed,
// so they keep pointing at it instead of at the old title.
//
// Only the title inside each link is replaced (see wikilink.RenameEdits), so
// decorations, labels and the characters around a link stay as they are. The
// cards are updated one after another: a failure leaves the cards before it
// updated, and running the rename again finishes the rest. A card that is open
// is changed live, so its editors receive the difference.
package serve

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpod/internal/api"
	"github.com/asano69/cardpod/internal/slug"
	"github.com/asano69/cardpod/internal/wikilink"
)

// renameLinksHandler serves POST /api/admin/cards/{id}/rename-links.
func renameLinksHandler(e *core.RequestEvent) error {
	var req api.RenameLinksRequest
	if err := e.BindBody(&req); err != nil {
		return e.BadRequestError("invalid request body", err)
	}
	if req.OldTitle == "" {
		return e.BadRequestError("oldTitle is required", nil)
	}

	card, err := e.App.FindRecordById("cards", e.Request.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		return e.NotFoundError("card not found", nil)
	}
	if err != nil {
		return e.InternalServerError("find card", err)
	}

	updated, err := renameLinks(e.App, card, req.OldTitle)
	if err != nil {
		return e.InternalServerError("update the links of the other cards", err)
	}
	return e.JSON(http.StatusOK, api.RenameLinksResponse{Updated: updated})
}

// renameLinks rewrites, in every card of card's pod that links to oldTitle
// (card itself included), those links to card's current title. It returns how
// many cards were changed.
func renameLinks(app core.App, card *core.Record, oldTitle string) (int, error) {
	newTitle := card.GetString("title")
	oldLc := slug.ToLowerKey(oldTitle)
	if oldLc == slug.ToLowerKey(newTitle) {
		return 0, nil // links match by titleLc, so they are still valid
	}

	ids, err := linkingCardIDs(app, card.GetString("pod"), oldLc)
	if err != nil {
		return 0, fmt.Errorf("find linking cards: %w", err)
	}

	updated := 0
	for _, id := range ids {
		changed, err := renameLinksIn(app, id, oldLc, newTitle)
		if err != nil {
			return updated, fmt.Errorf("update links of card %s: %w", id, err)
		}
		if changed {
			updated++
		}
	}
	return updated, nil
}

// renameLinksIn rewrites the links of one card. It reports whether the card
// held a link to rename (the text may have changed since card_links was last
// synced).
func renameLinksIn(app core.App, id, oldLc, newTitle string) (bool, error) {
	card, err := app.FindRecordById("cards", id)
	if err != nil {
		return false, err
	}
	text, err := loadCardText(app, card)
	if err != nil {
		return false, err
	}
	edits := wikilink.RenameEdits(text, oldLc, newTitle)
	if len(edits) == 0 {
		return false, nil
	}
	return true, saveCardText(app, card, wikilink.ApplyEdits(text, edits))
}

// linkingCardIDs returns the ids of the live cards whose text links to the
// target (pod, titleLc). The renamed card is included: its own text may link
// to its old title too.
func linkingCardIDs(app core.App, pod, titleLc string) ([]string, error) {
	ids := []string{}
	err := app.DB().NewQuery(`
		SELECT DISTINCT c.id FROM card_links l
		JOIN cards c ON c.id = l.source
		WHERE l.target_pod = {:pod} AND l.target_titleLc = {:titleLc}
			AND l.deleted = '' AND c.deleted = ''
		ORDER BY c.id`).
		Bind(dbx.Params{"pod": pod, "titleLc": titleLc}).
		Column(&ids)
	return ids, err
}
