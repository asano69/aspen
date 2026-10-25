// move_cards.go moves cards to another pod. A card never changes its pod:
// the old card is soft-deleted and a copy is created in the target pod, so
// every client learns about the move through the ordinary delete and create
// events (and the pull protocol), and the links of the copy are derived from
// its text in the new pod like those of any other card.
//
// The copy gets a new card id, so what users have seen of it (card_views)
// starts over. The note file of the old card is trashed by the note hooks.
package serve

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/asano69/cardpod/internal/api"
	"github.com/asano69/cardpod/internal/slug"
)

// moveCardsHandler serves POST /api/admin/cards/move.
func moveCardsHandler(e *core.RequestEvent) error {
	var req api.MoveCardsRequest
	if err := e.BindBody(&req); err != nil {
		return e.BadRequestError("invalid request body", err)
	}
	if req.Pod == "" || len(req.IDs) == 0 {
		return e.BadRequestError("pod and ids are required", nil)
	}

	_, err := e.App.FindRecordById("pods", req.Pod)
	if errors.Is(err, sql.ErrNoRows) {
		return e.NotFoundError("pod not found", nil)
	}
	if err != nil {
		return e.InternalServerError("find pod", err)
	}

	moved, err := moveCards(e.App, req.IDs, req.Pod)
	if err != nil {
		return e.InternalServerError("move the cards", err)
	}
	return e.JSON(http.StatusOK, api.MoveCardsResponse{Moved: moved})
}

// moveCards moves the cards with the given ids to destPod and returns how many
// were moved. The records change all or none; a note file written before a
// failure is left behind and overwritten when the move is tried again.
func moveCards(app core.App, ids []string, destPod string) (int, error) {
	cards, err := movableCards(app, ids, destPod)
	if err != nil {
		return 0, err
	}

	// The texts are read before the transaction, from the open cards where
	// there are any (see loadCardText).
	texts := make([]string, len(cards))
	for i, card := range cards {
		if texts[i], err = loadCardText(app, card); err != nil {
			return 0, err
		}
	}

	err = app.RunInTransaction(func(tx core.App) error {
		cardsCollection, err := tx.FindCollectionByNameOrId("cards")
		if err != nil {
			return err
		}
		// New cards get ever-higher positions and the grid lists the highest
		// first, so creating them in reverse keeps the order of ids on screen.
		for i := len(cards) - 1; i >= 0; i-- {
			if err := moveCard(tx, cardsCollection, cards[i], texts[i], destPod); err != nil {
				return fmt.Errorf("move card %s: %w", cards[i].Id, err)
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return len(cards), nil
}

// movableCards loads the cards to move, in the order of ids. A card that is
// listed twice, missing, deleted or already in destPod is skipped.
func movableCards(app core.App, ids []string, destPod string) ([]*core.Record, error) {
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
		if card.GetString("pod") == destPod || !card.GetDateTime("deleted").IsZero() {
			continue
		}
		cards = append(cards, card)
	}
	return cards, nil
}

// moveCard creates the copy of old in destPod and soft-deletes old. The copy's
// title is resolved like any new title there, so a collision gets a numeric
// suffix. It must run on the transaction's app.
func moveCard(tx core.App, cards *core.Collection, old *core.Record, text, destPod string) error {
	title, err := resolveTitle(tx, destPod, TitleCandidate(old.GetString("title")), "")
	if err != nil {
		return fmt.Errorf("resolve title: %w", err)
	}

	card := core.NewRecord(cards)
	card.Set("pod", destPod)
	card.Set("title", string(title))
	card.Set("titleLc", slug.ToLowerKey(string(title)))
	if err := tx.Save(card); err != nil {
		return fmt.Errorf("save card: %w", err)
	}
	if err := persistNote(tx, card.Id, text, nil); err != nil {
		return err
	}

	// The link cleanup hook marks the old card's links as deleted.
	old.Set("deleted", types.NowDateTime())
	return tx.Save(old)
}
