// Package serve: slug.go resolves a unique display "title" for a card
// from arbitrary candidate text (the card's header, or its first body
// line if the header is empty). This is deliberately separate from
// ydoc.go's Yjs persistence hook: title resolution is called for a new
// card (see createCardHandler in cards.go) and by the debounced header
// watcher (see title_watch.go), not on every Yjs update.
//
// A card's URL segment is no longer a separate stored field -- it's
// derived from this same title on demand (see internal/slug.FromTitle
// and its frontend mirror, frontend/src/lib/slugify.ts), since the
// (pot, title) unique index already guarantees a title never collides
// within a pot.
package serve

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpot/internal/slug"
)

// defaultTitle is used when a candidate resolves to no usable text at
// all -- e.g. an empty draft confirmed with Enter. Duplicate defaults
// are disambiguated the same way any other title is (see
// resolveUniqueTitleInPot).
const defaultTitle = "Untitled"

// resolveUniqueTitleInPot returns a value derived from base that is
// unique among "cards" records in pot -- unique on its DERIVED
// titleLc (see internal/slug.ToLowerKey), not on the raw title
// string. This matters because ToLowerKey is not injective: "a b"
// and "a_b" both normalize to "a_b" (case-insensitive, spaces mapped
// to underscores), so checking title equality alone would let two
// different titles land on the same URL segment (see
// internal/slug.FromTitle, which derives that segment from title on
// demand) and become indistinguishable by URL.
// excludeID lets a record keep resolving against its own current
// title without colliding with itself (pass "" for a brand-new
// record). Collisions are disambiguated with a numeric suffix ("_2",
// "_3", ...) appended to the title. Soft-deleted cards are ignored: they
// no longer occupy a title (so the unique indexes on "cards" must only
// cover live cards, i.e. WHERE deleted = '').
func resolveUniqueTitleInPot(app core.App, pot, base, excludeID string) (string, error) {
	value := base
	for suffix := 2; ; suffix++ {
		_, err := findLiveCardByTitleLc(app, pot, slug.ToLowerKey(value), excludeID)
		if errors.Is(err, sql.ErrNoRows) {
			return value, nil
		}
		if err != nil {
			return "", err
		}
		value = fmt.Sprintf("%s_%d", base, suffix)
	}
}

// findLiveCardByTitleLc returns the live card of pot whose titleLc is
// titleLc, other than excludeID, or sql.ErrNoRows. The values are bound as
// query parameters instead of being written into a PocketBase filter string:
// a filter string is parsed, and a title holding a backslash was altered by
// that parse, so the lookup missed a card that exists.
func findLiveCardByTitleLc(app core.App, pot, titleLc, excludeID string) (*core.Record, error) {
	record := &core.Record{}
	err := app.RecordQuery("cards").
		AndWhere(dbx.HashExp{"pot": pot, "titleLc": titleLc, "deleted": ""}).
		AndWhere(dbx.NewExp("id != {:id}", dbx.Params{"id": excludeID})).
		Limit(1).
		One(record)
	return record, err
}

// resolveTitle returns a title derived from candidate that is unique
// within pot, matching the "cards" collection's unique (pot, title)
// index. excludeID lets a card keep resolving against its own current
// title without colliding with itself.
//
// A candidate containing bracket-link markup ("[", "]") is treated as
// Scrapbox/Cosense-style word segmentation and normalized via
// slug.StripBracketLinks before becoming the title base -- e.g.
// "[D]" resolves to "D", not the literal "[D]". A candidate with no
// brackets at all is left completely untouched (see
// TestResolveTitle_PreservesCandidateWhitespaceVariants): only the
// presence of brackets triggers normalization, so plain whitespace
// variants are never altered.
func resolveTitle(app core.App, pot string, candidate TitleCandidate, excludeID string) (CardTitle, error) {
	value, err := resolveUniqueTitleInPot(app, pot, titleBase(candidate), excludeID)
	return CardTitle(value), err
}

// titleBase normalizes candidate into the title resolveTitle starts from,
// before any uniqueness suffix is applied. It is also what a caller must
// use to find the card a candidate would resolve to when no other card
// competes for it (see import.go).
func titleBase(candidate TitleCandidate) string {
	base := string(candidate)
	if strings.ContainsAny(base, "[]") {
		base = slug.StripBracketLinks(base)
	}
	if base == "" {
		base = defaultTitle
	}
	// A base that case-insensitively matches a reserved route segment (see
	// internal/slug.IsReserved) is disambiguated here, before the
	// uniqueness loop runs. Without this, such a title would only be
	// caught later by the "cards" collection's OnRecordValidate hook (see
	// validate.go), and that rejection made the retry loop in
	// createCardHandler/updateCardTitleHandler bump the title into
	// "..._2" instead of the properly disambiguated "..._".
	if slug.IsReserved(base) {
		base += "_"
	}
	return base
}

// findMergeTarget returns the title of the card that candidate collided
// with, or "" when it did not. A collision means resolveTitle had to
// disambiguate: the resolved title differs from the base title the
// candidate asks for, because another live card of the pot (excluding
// excludeID) already holds that base's titleLc. Comparing against the base
// instead of looking at a "_<number>" suffix keeps a title the user typed
// as "p_2" from being reported as a duplicate of "p".
func findMergeTarget(app core.App, pot string, candidate TitleCandidate, title CardTitle, excludeID string) (CardTitle, error) {
	base := titleBase(candidate)
	if string(title) == base {
		return "", nil
	}

	other, err := app.FindFirstRecordByFilter(
		"cards",
		"pot = {:pot} && id != {:id} && titleLc = {:titleLc} && "+notDeleted,
		dbx.Params{"pot": pot, "id": excludeID, "titleLc": slug.ToLowerKey(base)},
	)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return CardTitle(other.GetString("title")), nil
}
