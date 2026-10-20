// links.go implements the /api/pages/{pot}/{slug}/links1hop and /links2hop
// routes. The related cards are found with SQL over the "cards" and
// "card_links" collections, using the (pot, titleLc) index of "cards" and
// the (target_pot, target_titleLc) and (source) indexes of "card_links".
// Each route runs one query for the related cards and one for their link
// targets, however many cards it returns.
package serve

import (
	"database/sql"
	"errors"
	"net/http"
	"slices"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/asano69/cardpod/internal/api"
	"github.com/asano69/cardpod/internal/slug"
)

// linkedCard is one entry in the links1hop and links2hop responses. It holds
// everything the frontend's card grid needs to draw a card, so both routes
// share this one shape (defined in internal/api, which also feeds the
// frontend's generated types).
type linkedCard = api.LinkedCard

// findCardBySlug looks up the card in pot whose title slugifies (see
// internal/slug.FromTitle) to targetSlug, using the "cards" collection's
// existing (pot, titleLc) unique index instead of a full linear scan.
//
// titleLc is derived from title via internal/slug.ToLowerKey: lowercase,
// spaces replaced with underscores. Since a card's title can never contain
// "[" or "]" (see the "cards" collection's title field pattern), FromTitle's
// no-bracket branch performs that same space-to-underscore substitution, so
// strings.ToLower(targetSlug) is exactly the titleLc of any title that would
// slugify to targetSlug. Titles can also never be a reserved word (see
// internal/slug.IsReserved, enforced by validate.go's OnRecordValidate
// hook), so FromTitle's reserved-suffix branch never applies to a stored
// title and can be ignored here.
//
// The FromTitle comparison below is kept as a final check on the single
// matched candidate since titleLc is case-insensitive but targetSlug is not:
// it guards against a different-case title that happens to share the same
// titleLc. Returns (nil, nil) when no card matches.
func findCardBySlug(app core.App, potID, targetSlug string) (*core.Record, error) {
	candidateTitleLc := strings.ToLower(targetSlug)
	candidate, err := app.FindFirstRecordByFilter(
		"cards", "pot = {:pot} && titleLc = {:titleLc} && "+notDeleted,
		dbx.Params{"pot": potID, "titleLc": candidateTitleLc},
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if slug.FromTitle(candidate.GetString("title")) != targetSlug {
		return nil, nil
	}
	return candidate, nil
}

// absentCard returns a stand-in for a card that does not exist (yet), so the
// link queries below can answer for it: it has no id, so it links to nothing,
// but other cards may already link to its title. Its titleLc is derived from
// the slug the same way findCardBySlug derives its candidate.
func absentCard(app core.App, potID, targetSlug string) (*core.Record, error) {
	collection, err := app.FindCollectionByNameOrId("cards")
	if err != nil {
		return nil, err
	}
	card := core.NewRecord(collection)
	card.Set("id", "")
	card.Set("pot", potID)
	card.Set("titleLc", strings.ToLower(targetSlug))
	return card, nil
}

// ownTargetTitleLcs returns every target_titleLc a card links to as a
// source -- its own one-hop-out neighborhood.
func ownTargetTitleLcs(app core.App, cardID string) ([]string, error) {
	links, err := app.FindRecordsByFilter(
		"card_links", "source = {:source} && "+notDeleted, "position", 0, 0,
		dbx.Params{"source": cardID},
	)
	if err != nil {
		return nil, err
	}
	targets := make([]string, 0, len(links))
	for _, link := range links {
		targets = append(targets, link.GetString("target_titleLc"))
	}
	return targets, nil
}

// relatedCardsHandler answers with whatever find returns for the requested
// card, under the JSON key "key". A card that does not exist yet is answered
// for too (see absentCard), since other cards may already link to it.
func relatedCardsHandler[T any](key string, find func(core.App, *core.Record) (T, error)) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		pot, err := e.App.FindFirstRecordByFilter(
			"pots", "name = {:name}", dbx.Params{"name": e.Request.PathValue("pot")},
		)
		if errors.Is(err, sql.ErrNoRows) {
			return e.NotFoundError("pot not found", nil)
		}
		if err != nil {
			return e.InternalServerError("find pot", err)
		}

		slugParam := e.Request.PathValue("slug")
		card, err := findCardBySlug(e.App, pot.Id, slugParam)
		if err == nil && card == nil {
			card, err = absentCard(e.App, pot.Id, slugParam)
		}
		if err != nil {
			return e.InternalServerError("find card", err)
		}

		result, err := find(e.App, card)
		if err != nil {
			return e.InternalServerError("compute "+key, err)
		}
		return e.JSON(http.StatusOK, map[string]any{key: result})
	}
}

// oneHopIDs is the SQL subquery selecting the ids of the cards one wiki-link
// hop away from a card: the cards it links to (that actually exist) and the
// cards that link to it. It is the single definition of "1 hop", shared by
// links1Hop (IN) and links2Hop (NOT IN). It does not filter deleted cards or
// the card itself; relatedCards does that. It is uncorrelated, so SQLite
// evaluates it once per query.
const oneHopIDs = `
	SELECT c.id FROM cards c
	JOIN card_links l ON l.target_pot = c.pot AND l.target_titleLc = c.titleLc
	WHERE l.source = {:id} AND l.deleted = ''
	UNION
	SELECT source FROM card_links
	WHERE target_pot = {:pot} AND target_titleLc = {:titleLc} AND deleted = ''`

// links1Hop returns the live cards one wiki-link hop away from card (see
// oneHopIDs).
func links1Hop(app core.App, card *core.Record) ([]linkedCard, error) {
	return relatedCards(app, card, "cards.id IN ("+oneHopIDs+")")
}

// links2Hop returns the live cards of the same pot that link to at least one
// of the targets card links to (A --> X <-- B), one row per card. X does not
// have to exist. A card sharing several targets appears only once, under the
// shared target that comes first in card; targets nobody else links to
// produce no row. Rows are ordered by the position of X in card, then by
// title. Cards that are already one hop
// away (see oneHopIDs) are excluded, so a card never shows up in both views.
func links2Hop(app core.App, card *core.Record) ([]api.Link2HopCard, error) {
	cards, err := relatedCards(app, card, `cards.id IN (
		SELECT l2.source FROM card_links l1
		JOIN card_links l2
			ON l2.target_pot = l1.target_pot AND l2.target_titleLc = l1.target_titleLc
		WHERE l1.source = {:id} AND l1.deleted = '' AND l2.deleted = ''
	) AND cards.id NOT IN (`+oneHopIDs+")")
	if err != nil {
		return nil, err
	}

	// Sync keeps one row per target_titleLc, so no target repeats here. The
	// groups follow the order in which the links appear in the card.
	links, err := app.FindRecordsByFilter(
		"card_links", "source = {:source} && "+notDeleted, "position,target_titleLc", 0, 0,
		dbx.Params{"source": card.Id},
	)
	if err != nil {
		return nil, err
	}

	rows := []api.Link2HopCard{}
	// links is ordered by position, so the first target a card matches is the
	// one with the smallest position. A card already listed is skipped, which
	// keeps it out of every later group.
	listed := make(map[string]bool, len(cards))
	for _, link := range links {
		titleLc := link.GetString("target_titleLc")
		for _, c := range cards {
			if listed[c.TitleLc] || !slices.Contains(c.TargetTitleLc, titleLc) {
				continue
			}
			listed[c.TitleLc] = true
			rows = append(rows, api.Link2HopCard{
				LinkedCard: c,
				ViaTitle:   link.GetString("target_title"),
				ViaTitleLc: titleLc,
			})
		}
	}
	return rows, nil
}

// relatedCards loads the live cards of card's pot, other than card itself,
// that match condition, sorted by title. condition may use the {:id},
// {:pot} and {:titleLc} parameters of card.
func relatedCards(app core.App, card *core.Record, condition string) ([]linkedCard, error) {
	var records []*core.Record
	err := app.RecordQuery("cards").
		AndWhere(dbx.NewExp(
			"cards.pot = {:pot} AND cards.deleted = '' AND cards.id != {:id} AND ("+condition+")",
			dbx.Params{
				"id":      card.Id,
				"pot":     card.GetString("pot"),
				"titleLc": card.GetString("titleLc"),
			},
		)).
		OrderBy("cards.title").
		All(&records)
	if err != nil {
		return nil, err
	}

	ids := make([]any, len(records))
	for i, record := range records {
		ids[i] = record.Id
	}
	targets, err := targetTitleLcsBySource(app, ids)
	if err != nil {
		return nil, err
	}

	result := make([]linkedCard, len(records))
	for i, record := range records {
		linkTargets := targets[record.Id]
		if linkTargets == nil {
			linkTargets = []string{}
		}
		result[i] = linkedCard{
			ID:            record.Id,
			Title:         CardTitle(record.GetString("title")),
			TitleLc:       record.GetString("titleLc"),
			Description:   types.JSONRaw(record.GetString("description")),
			Image:         record.GetString("image"),
			Pin:           record.GetFloat("pin"),
			TargetTitleLc: linkTargets,
		}
	}
	return result, nil
}

// targetTitleLcsBySource returns, for each of the given source card ids, the
// target_titleLc of every link it has, in one query.
func targetTitleLcsBySource(app core.App, ids []any) (map[string][]string, error) {
	targets := make(map[string][]string, len(ids))
	if len(ids) == 0 {
		return targets, nil
	}

	var rows []struct {
		Source        string `db:"source"`
		TargetTitleLc string `db:"target_titleLc"`
	}
	err := app.DB().
		Select("source", "target_titleLc").
		From("card_links").
		Where(dbx.And(dbx.In("source", ids...), dbx.HashExp{"deleted": ""})).
		All(&rows)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		targets[row.Source] = append(targets[row.Source], row.TargetTitleLc)
	}
	return targets, nil
}
