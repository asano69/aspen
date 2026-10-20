// move_cards.go moves cards to another pot. A card never changes its pot:
// the old card is soft-deleted and a copy is created in the target pot, so
// every client learns about the move through the ordinary delete and create
// events (and the pull protocol), and the links of the copy are derived from
// its text in the new pot like those of any other card.
//
// The copy gets the full Yjs state of the old card, so its text, line ids and
// line meta are kept. It gets a new card id, so what users have seen of it
// (card_views) starts over.
package serve

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/reearth/ygo/crdt"

	"github.com/asano69/cardpod/internal/api"
	"github.com/asano69/cardpod/internal/slug"
)

// moveCardsHandler serves POST /api/admin/cards/move.
func moveCardsHandler(e *core.RequestEvent) error {
	var req api.MoveCardsRequest
	if err := e.BindBody(&req); err != nil {
		return e.BadRequestError("invalid request body", err)
	}
	if req.Pot == "" || len(req.IDs) == 0 {
		return e.BadRequestError("pot and ids are required", nil)
	}

	_, err := e.App.FindRecordById("pots", req.Pot)
	if errors.Is(err, sql.ErrNoRows) {
		return e.NotFoundError("pot not found", nil)
	}
	if err != nil {
		return e.InternalServerError("find pot", err)
	}

	moved, err := moveCards(e.App, req.IDs, req.Pot)
	if err != nil {
		return e.InternalServerError("move the cards", err)
	}
	return e.JSON(http.StatusOK, api.MoveCardsResponse{Moved: moved})
}

// moveCards moves the cards with the given ids to destPot, all or none, and
// returns how many were moved.
func moveCards(app core.App, ids []string, destPot string) (int, error) {
	cards, err := movableCards(app, ids, destPot)
	if err != nil {
		return 0, err
	}

	// The docs are read before the transaction, from the live rooms where
	// there are any (see loadCardDoc).
	p := &ydocPersistence{app: app}
	docs := make([]*crdt.Doc, len(cards))
	for i, card := range cards {
		if docs[i], _, err = loadCardDoc(p, card.Id); err != nil {
			return 0, err
		}
	}

	err = app.RunInTransaction(func(tx core.App) error {
		cardsCollection, err := tx.FindCollectionByNameOrId("cards")
		if err != nil {
			return err
		}
		ydocs, err := tx.FindCollectionByNameOrId("card_ydocs")
		if err != nil {
			return err
		}
		// New cards get ever-higher positions and the grid lists the highest
		// first, so creating them in reverse keeps the order of ids on screen.
		for i := len(cards) - 1; i >= 0; i-- {
			if err := moveCard(tx, cardsCollection, ydocs, cards[i], docs[i], destPot); err != nil {
				return fmt.Errorf("move card %s: %w", cards[i].Id, err)
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}

	// Only after the commit, since closing a room cannot be rolled back. Its
	// peers reconnect and are refused, because the card is deleted now.
	for _, card := range cards {
		forgetRoom(card.Id)
	}
	return len(cards), nil
}

// movableCards loads the cards to move, in the order of ids. A card that is
// listed twice, missing, deleted or already in destPot is skipped.
func movableCards(app core.App, ids []string, destPot string) ([]*core.Record, error) {
	var cards []*core.Record
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true

		card, err := app.FindRecordById("cards", id)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if card.GetString("pot") == destPot || !card.GetDateTime("deleted").IsZero() {
			continue
		}
		cards = append(cards, card)
	}
	return cards, nil
}

// moveCard creates the copy of old in destPot and soft-deletes old. The copy's
// title is resolved like any new title there, so a collision gets a numeric
// suffix. It must run on the transaction's app.
func moveCard(tx core.App, cards, ydocs *core.Collection, old *core.Record, doc *crdt.Doc, destPot string) error {
	title, err := resolveTitle(tx, destPot, TitleCandidate(old.GetString("title")), "")
	if err != nil {
		return fmt.Errorf("resolve title: %w", err)
	}

	card := core.NewRecord(cards)
	card.Set("pot", destPot)
	card.Set("title", string(title))
	card.Set("titleLc", slug.ToLowerKey(string(title)))
	if err := tx.Save(card); err != nil {
		return fmt.Errorf("save card: %w", err)
	}

	err = saveRenamed(tx, &ydocPersistence{app: tx}, ydocs, &renamedCard{
		id:    card.Id,
		text:  doc.GetText("content").ToString(),
		state: doc.EncodeStateAsUpdate(),
	})
	if err != nil {
		return err
	}

	// The link cleanup hook marks the old card's links as deleted.
	old.Set("deleted", types.NowDateTime())
	return tx.Save(old)
}
