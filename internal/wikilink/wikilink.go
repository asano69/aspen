// Package wikilink keeps the "card_links" collection in sync with the
// [wiki links] found in each card's text, so 1-hop and 2-hop link views
// can be answered from the database instead of re-parsing every card.
//
// A link row stores its target only as text (target_title and
// target_titleLc, mirroring the "cards" fields of the same names). The
// target card may not exist yet, may be renamed, or may be created later,
// so a link never needs to know whether its target exists. Its identity is
// target_titleLc -- the same case-insensitive key "cards" itself uses to
// enforce title uniqueness (see internal/serve/slug.go's
// resolveUniqueTitleInPot) -- and a target is matched to a card only at
// query time, by (pot, titleLc).
package wikilink

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/asano69/cardpot/internal/parser"
	"github.com/asano69/cardpot/internal/slug"
)

// Sync makes card_links match the wiki links in text for the card cardID:
// rows for links that disappeared are marked deleted (never removed, so a
// client that was offline learns about it from its next pull, see
// internal/replica) and rows for new links are created, all in one
// transaction. When nothing changed, nothing is written.
// A card that no longer exists is ignored.
//
// Every link is stored, including links to the card itself: whether that is
// a self link depends on the card's current titleLc, which can change
// without Sync running again, so it is left to whoever queries the links.
func Sync(app core.App, cardID, text string) error {
	source, err := app.FindRecordById("cards", cardID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil // card deleted concurrently
	}
	if err != nil {
		return err
	}
	pot := source.GetString("pot")

	// A deleted card links to nothing: its rows are marked deleted like those
	// of any removed link, so the source of a live link is always a live card.
	if !source.GetDateTime("deleted").IsZero() {
		text = ""
	}

	targets := orderedTargets(parser.Parse(text).LinkTitles())

	existing, err := app.FindRecordsByFilter(
		"card_links", `source = {:source} && deleted = ""`, "", 0, 0,
		dbx.Params{"source": cardID},
	)
	if err != nil {
		return err
	}

	collection, err := app.FindCollectionByNameOrId("card_links")
	if err != nil {
		return err
	}

	stale, kept := splitExisting(existing, targets)

	// A new row, or a kept row whose position changed, must be written.
	var toSave []*core.Record
	for position, t := range targets {
		record := kept[t.titleLc]
		if record == nil {
			record = core.NewRecord(collection)
			record.Set("source", cardID)
			// A wiki link's target is resolved within the same pot as its
			// source card (see slug.go's resolveTitle), so this is stored
			// alongside target_titleLc to make the reverse lookup (which
			// cards link to a given card) possible without having to
			// re-derive the pot from the source card each time.
			record.Set("target_pot", pot)
			record.Set("target_titleLc", t.titleLc)
			record.Set("target_title", t.title)
		} else if record.GetInt("position") == position {
			continue
		}
		record.Set("position", position)
		toSave = append(toSave, record)
	}
	if len(stale) == 0 && len(toSave) == 0 {
		return nil
	}

	return app.RunInTransaction(func(tx core.App) error {
		// PocketBase's validation errors do not name the value they reject,
		// so each failure is wrapped with the link it belongs to.
		for _, record := range stale {
			record.Set("deleted", types.NowDateTime())
			if err := tx.Save(record); err != nil {
				return fmt.Errorf("delete link to %q: %w", record.GetString("target_title"), err)
			}
		}
		for _, record := range toSave {
			if err := tx.Save(record); err != nil {
				return fmt.Errorf("save link to %q: %w", record.GetString("target_title"), err)
			}
		}
		return nil
	})
}

// linkKey returns the identity (titleLc) of a link title, or "" when the title
// normalizes to no usable text. Shared by Sync and RenameEdits, so both always
// agree on which links point at the same card.
func linkKey(title string) string {
	base := title
	if strings.ContainsAny(base, "[]") {
		base = slug.StripBracketLinks(base)
	}
	if base == "" {
		return ""
	}
	return slug.ToLowerKey(base)
}

// target is one distinct link target of a card.
type target struct {
	titleLc string // identity, see internal/slug.ToLowerKey
	title   string // raw title under which it was first linked
}

// orderedTargets returns the distinct link targets in the order they first
// appear in the text, so a card linking [a][b][a][c] yields a, b, c. A
// target's identity is its titleLc (see internal/slug.ToLowerKey), the same
// normalization resolveTitle applies to a card's own title before saving
// (see internal/serve/slug.go), so a wiki link's identity always matches how
// its target card would itself be identified. Titles that normalize to no
// usable text at all (e.g. a link made only of brackets and spaces) cannot
// be stored and are dropped.
func orderedTargets(titles []string) []target {
	var targets []target
	seen := make(map[string]bool, len(titles))
	for _, title := range titles {
		key := linkKey(title)
		if key == "" {
			continue
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		// target_title must not contain brackets (see the card_links schema),
		// so they are stripped the same way linkKey strips them.
		if strings.ContainsAny(title, "[]") {
			title = slug.StripBracketLinks(title)
		}
		targets = append(targets, target{titleLc: key, title: title})
	}
	return targets
}

// splitExisting separates the stored rows into stale rows (a link that is
// gone, or a duplicate row), which must be deleted, and the kept row of each
// wanted target, keyed by titleLc. The stored target_title of a kept row is
// left as is: the row's identity is its titleLc, so a different spelling of
// the same titleLc is not a change.
func splitExisting(existing []*core.Record, targets []target) (stale []*core.Record, kept map[string]*core.Record) {
	wanted := make(map[string]bool, len(targets))
	for _, t := range targets {
		wanted[t.titleLc] = true
	}
	kept = make(map[string]*core.Record, len(existing))
	for _, record := range existing {
		titleLc := record.GetString("target_titleLc")
		if wanted[titleLc] && kept[titleLc] == nil {
			kept[titleLc] = record
			continue
		}
		stale = append(stale, record)
	}
	return stale, kept
}
