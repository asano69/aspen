// Package slug converts a card's title into a URL-safe path segment.
// This is a pure, stateless text transform with no database access:
// any given title always slugifies to the same string, on both the
// frontend and the backend. It replaces the old persisted, uniqueness-
// disambiguated "slug" field entirely -- with the (pod, titleLc) index
// already guaranteeing a card's title is unique per pod, the URL
// segment can simply be derived from that title on demand instead of
// being stored and kept in sync.
//
// The frontend has its own mirror of this exact algorithm (see
// frontend/src/lib/slugify.ts), since a card's edit URL is built from
// its title on the frontend and, for now, resolved back into a record
// on the frontend too (see routes/cards/CardForm.tsx) -- there is
// currently no backend route that needs to reverse a URL segment back
// into a record. Both implementations must stay in lockstep; add a
// test here whenever slugify.ts's test suite gains one, and vice versa.
package slug

import "strings"

// splitWords splits s on runs of "[", "]", and space, dropping empty
// fields. Brackets commonly show up in text imported from
// bracket-link wikis (e.g. "[some page]") and act as a word separator
// just like whitespace does -- consecutive brackets/spaces collapse
// into a single separator either way, so "[a][b]" and "[a] [b]" both
// produce the word list ["a", "b"].
func splitWords(s string) []string {
	return strings.FieldsFunc(s, func(r rune) bool {
		return r == '[' || r == ']' || r == ' '
	})
}

// StripBracketLinks removes Scrapbox/Cosense-style bracket-link markup
// from a raw title candidate, returning its words rejoined with a
// single space -- e.g. "[A B[X]C D]" -> "A B X C D". Reuses the same
// separator class as FromTitle (brackets and spaces), so a title
// produced this way slugifies identically whether or not it still
// contains brackets. Returns "" when the candidate carries no words at
// all (e.g. "[[]]"); callers are responsible for applying their own
// empty-title fallback (see resolveTitle in internal/serve/slug.go).
//
// Unlike FromTitle, this does not collapse to a reserved-word suffix:
// it produces a display title, not a URL segment, so there is no
// route to collide with.
func StripBracketLinks(candidate string) string {
	return strings.Join(splitWords(candidate), " ")
}

// FromTitle converts a card's title into a URL-safe slug.
//
// The bracket-collapsing branch below only matters for defense in
// depth: resolveTitle (internal/serve/slug.go) already strips bracket
// markup out of a candidate before it is ever persisted as a title,
// so a real title should never contain brackets by the time it
// reaches this function.
//
// When title has no brackets (the normal case), each space maps to
// its own "_" one-to-one, so titles that differ only in how many
// spaces they have ("A B" vs "A  B") keep distinguishable slugs
// instead of collapsing into the same one.
//
// When title does contain brackets, any run of brackets/spaces --
// including at the edges -- collapses into a single "_", matching
// StripBracketLinks' own collapsing rule. Non-ASCII characters (e.g.
// Japanese) are left as-is either way; percent-encoding the handful of
// characters that are actually unsafe in a path segment (% / # ?) is
// the caller's job (see frontend/src/lib/slugify.ts's titleToSegment).
//
// A result that would collide with a reserved route segment (e.g.
// "new") gets a trailing underscore appended, deterministically, so
// FromTitle never needs a database round-trip to avoid that collision.
// NOTE: a SQL expression index mirroring this function's no-bracket
// branch also exists on the "cards" collection
// (idx_cards_pod_normtitle, added via the PocketBase admin UI), so two
// titles that would derive the same URL segment can never coexist in
// the same pod even though the segment itself is never stored (see
// resolveUniqueTitleInPod in internal/serve/slug.go, which relies on
// titleLc for the same purpose). That SQL expression assumes title
// never contains brackets (guaranteed by resolveTitle -- see this
// function's own comment above) and therefore only mirrors the "else"
// branch below (space -> underscore, plus the "new" reserved word
// case). If this function's no-bracket branch's behavior ever
// changes, that SQL expression must be updated to match, or the DB
// constraint will silently stop reflecting what this function
// actually computes.
func FromTitle(title string) string {
	var joined string
	if strings.ContainsAny(title, "[]") {
		joined = strings.Join(splitWords(title), "_")
	} else {
		joined = strings.ReplaceAll(title, " ", "_")
	}
	if cardTitleReserved[joined] {
		return joined + "_"
	}
	return joined
}
