// rename_links.go rewrites the links of other cards after a card was renamed,
// so they keep pointing at it instead of at the old title.
//
// A card's text is not a plain column: it only exists as Yjs updates in the
// "card_ydocs" log. The links are therefore edited as a Yjs transaction on the
// card's doc (see wikilink.RenameEdits), only at the places where the link is
// written, so concurrent edits of the same card are not disturbed.
//
// The work has three steps:
//  1. Prepare (parallel): for every linking card, compute the edited doc.
//     Nothing is written.
//  2. Commit (one DB transaction): store every edited doc and bring the
//     derived data (description, card_links) of every card up to date. All
//     cards change or none does.
//  3. Publish: a card whose room is loaded in memory has its room closed.
//     Applying the edit to the server's doc would not reach the peers, so
//     they reconnect instead and the room reloads from the log committed in
//     step 2. This cannot be rolled back, so it only runs after the commit
//     succeeded.
package serve

import (
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/reearth/ygo/crdt"

	"github.com/asano69/cardpod/internal/api"
	"github.com/asano69/cardpod/internal/slug"
	"github.com/asano69/cardpod/internal/wikilink"
)

// maxRenameWorkers bounds how many cards are prepared at the same time.
const maxRenameWorkers = 8

// renamedCard is the result of preparing one card.
type renamedCard struct {
	id    string
	text  string    // the text after the edit
	state []byte    // the full doc state after the edit
	live  *crdt.Doc // the room's live doc, or nil when the room is not loaded
}

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

// renameLinks rewrites, in every card of card's pot that links to oldTitle
// (card itself included), those links to card's current title. It returns how
// many cards were changed.
func renameLinks(app core.App, card *core.Record, oldTitle string) (int, error) {
	newTitle := card.GetString("title")
	oldLc := slug.ToLowerKey(oldTitle)
	if oldLc == slug.ToLowerKey(newTitle) {
		return 0, nil // links match by titleLc, so they are still valid
	}

	ids, err := linkingCardIDs(app, card.GetString("pot"), oldLc)
	if err != nil {
		return 0, fmt.Errorf("find linking cards: %w", err)
	}

	prepared, err := prepareRenames(app, ids, oldLc, newTitle)
	if err != nil {
		return 0, err
	}
	if len(prepared) == 0 {
		return 0, nil
	}

	err = app.RunInTransaction(func(tx core.App) error {
		collection, err := tx.FindCollectionByNameOrId("card_ydocs")
		if err != nil {
			return err
		}
		p := &ydocPersistence{app: tx}
		for _, r := range prepared {
			if err := saveRenamed(tx, p, collection, r); err != nil {
				return fmt.Errorf("update links of card %s: %w", r.id, err)
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}

	for _, r := range prepared {
		if r.live == nil {
			continue
		}
		// Peers reconnect and merge whatever they typed since the snapshot
		// was taken, so nothing is lost by closing the room.
		if err := yjsServer.CloseRoom(r.id, true); err != nil {
			slog.Warn("close room after link rename", "room", r.id, "error", err)
		}
	}
	return len(prepared), nil
}

// prepareRenames prepares every card in ids in parallel and returns those that
// actually changed.
func prepareRenames(app core.App, ids []string, oldLc, newTitle string) ([]*renamedCard, error) {
	p := &ydocPersistence{app: app}
	results := make([]*renamedCard, len(ids))
	errs := make([]error, len(ids))

	sem := make(chan struct{}, maxRenameWorkers)
	var wg sync.WaitGroup
	for i, id := range ids {
		sem <- struct{}{}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			results[i], errs[i] = prepareRename(p, id, oldLc, newTitle)
		}()
	}
	wg.Wait()
	if err := errors.Join(errs...); err != nil {
		return nil, err
	}

	var changed []*renamedCard
	for _, r := range results {
		if r != nil {
			changed = append(changed, r)
		}
	}
	return changed, nil
}

// prepareRename computes the edited doc of one card without writing anything.
// It returns nil when the card holds no link to rename (e.g. the text changed
// since card_links was last synced).
//
// A loaded room is the source of truth, because the stored log can be a few
// seconds behind it. The edit is made on a scratch copy, so the live doc stays
// untouched until the database commit succeeded.
func prepareRename(p *ydocPersistence, room, oldLc, newTitle string) (*renamedCard, error) {
	doc, live, err := loadCardDoc(p, room)
	if err != nil {
		return nil, err
	}

	content := doc.GetText("content")
	edits := wikilink.RenameEdits(content.ToString(), oldLc, newTitle)
	if len(edits) == 0 {
		return nil, nil
	}

	// All edits of the card share one transaction, so it produces one update.
	doc.Transact(func(txn *crdt.Transaction) {
		for _, edit := range edits { // ordered from the end of the text
			if edit.Len > 0 {
				content.Delete(txn, edit.From, edit.Len)
			}
			if edit.Insert != "" {
				content.Insert(txn, edit.From, edit.Insert, nil)
			}
		}
	})

	return &renamedCard{
		id:    room,
		text:  content.ToString(),
		state: doc.EncodeStateAsUpdate(),
		live:  live,
	}, nil
}

// saveRenamed stores the edited doc of a card as one new record of the update
// log (like ydocPersistence.replaceContent does) and refreshes the data
// derived from the text. It must run on the transaction's app.
func saveRenamed(tx core.App, p *ydocPersistence, ydocs *core.Collection, r *renamedCard) error {
	record := core.NewRecord(ydocs)
	record.Set("card", r.id)
	record.Set("payload", base64.StdEncoding.EncodeToString(r.state))
	if err := tx.Save(record); err != nil {
		return fmt.Errorf("save card document: %w", err)
	}
	return p.syncDerived(r.id, r.text)
}

// loadCardDoc returns a scratch copy of a card's doc, so an edit can be
// computed without touching the live one, and the room's live doc (nil when
// the room is not loaded). A loaded room is the source of truth, because the
// stored log can be a few seconds behind it.
func loadCardDoc(p *ydocPersistence, room string) (doc, live *crdt.Doc, err error) {
	live = liveDoc(room)

	var stored []byte
	if live != nil {
		stored = live.EncodeStateAsUpdate()
	} else if stored, err = p.LoadDoc(room); err != nil {
		return nil, nil, fmt.Errorf("load card %s: %w", room, err)
	}

	doc = crdt.New()
	if len(stored) > 0 {
		if err := doc.ApplyUpdate(stored); err != nil {
			return nil, nil, fmt.Errorf("apply stored updates of card %s: %w", room, err)
		}
	}
	return doc, live, nil
}

// liveDoc returns the doc of room if it is loaded in memory, or nil.
func liveDoc(room string) *crdt.Doc {
	if yjsServer == nil {
		return nil
	}
	return yjsServer.GetDoc(room)
}

// linkingCardIDs returns the ids of the live cards whose text links to the
// target (pot, titleLc). The renamed card is included: its own text may link
// to its old title too.
func linkingCardIDs(app core.App, pot, titleLc string) ([]string, error) {
	ids := []string{}
	err := app.DB().NewQuery(`
		SELECT DISTINCT c.id FROM card_links l
		JOIN cards c ON c.id = l.source
		WHERE l.target_pot = {:pot} AND l.target_titleLc = {:titleLc}
			AND l.deleted = '' AND c.deleted = ''
		ORDER BY c.id`).
		Bind(dbx.Params{"pot": pot, "titleLc": titleLc}).
		Column(&ids)
	return ids, err
}
