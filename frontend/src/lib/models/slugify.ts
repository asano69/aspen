// frontend/src/lib/slugify.ts
//
// Converts a card's title into the URL path segment used to display
// it (see pages/cards/CardForm.tsx and CardItem.tsx). This replaces
// the old persisted, server-disambiguated "slug" field entirely: since
// a card's title is already guaranteed unique within its pod (see the
// "cards" collection's (pod, title) unique index), the URL segment can
// simply be derived from that title on demand.
//
// The backend has its own mirror of the exact same algorithm (see
// internal/slug/slug.go) -- both must stay in lockstep, since the
// frontend builds a card's edit link from titleToSegment(title) and,
// for now, resolves that same URL back into a record by recomputing
// titleToSlug for every candidate card and comparing (see
// CardForm.tsx) -- there is currently no backend route that reverses a
// URL segment back into a record.

// Reserved segments that must never collide with a real card's slug,
// since they're claimed by a static route (see lib/router.tsx's
// "/:slug/new"). Mirrors internal/slug/slug.go's own `reserved` map.
const RESERVED_SEGMENTS = new Set(["new"]);

// Splits text on runs of "[", "]", and space, dropping empty entries.
// Brackets commonly show up in text imported from bracket-link wikis
// (e.g. "[some page]") and act as a word separator just like
// whitespace does.
function splitWords(text: string): string[] {
  return text.split(/[[\] ]+/).filter((word) => word !== "");
}

// Converts title into a URL-safe slug.
//
// The bracket-collapsing branch below only matters for defense in
// depth: a card's title never contains bracket markup by the time it
// reaches this function (see internal/serve/slug.go's resolveTitle,
// which strips it before saving), but it's kept in sync with the
// server's own collapsing rule just in case.
//
// When title has no brackets (the normal case), each space maps to
// its own "_" one-to-one, so titles that differ only in how many
// spaces they have ("A B" vs "A  B") keep distinguishable slugs
// instead of collapsing into the same one.
//
// When title does contain brackets, any run of brackets/spaces --
// including at the edges -- collapses into a single "_". Non-ASCII
// characters (e.g. Japanese) are left as-is either way. A result that
// would collide with a reserved route segment gets a trailing
// underscore appended, deterministically, so this never needs a
// round-trip to the server to avoid that collision.
export function titleToSlug(title: string): string {
  const joined = /[[\]]/.test(title)
    ? splitWords(title).join("_")
    : title.replaceAll(" ", "_");
  return RESERVED_SEGMENTS.has(joined) ? `${joined}_` : joined;
}

// Percent-encodes the characters that are actually unsafe in a path
// segment: % / # ?, plus any ASCII control character (e.g. a stray tab
// pasted into a title), which browsers can silently mangle or strip.
// Everything else, including non-ASCII text such as Japanese and the
// underscores titleToSlug already produces, is left as-is so it shows
// up literally in the browser instead of being percent-encoded the
// way encodeURIComponent would do it.
function encodeUnsafeChars(slug: string): string {
  return (
    slug
      .replaceAll("%", "%25") // must run first, or the escapes below would be double-encoded
      .replaceAll("/", "%2F")
      .replaceAll("#", "%23")
      .replaceAll("?", "%3F")
      // Matching ASCII control characters is the whole point of this regex.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f]/g, encodeControlChar)
  );
}

// Percent-encodes a single ASCII control character (tab, newline, ...).
// Only ever called for characters the regex in encodeUnsafeChars
// matched, so printable non-ASCII text (Japanese, the full-width space
// U+3000, ...) never reaches this function.
function encodeControlChar(ch: string): string {
  return `%${ch.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()}`;
}

// Converts a card's title straight into the URL path segment used to
// link to it (see CardItem.tsx).
export function titleToSegment(title: string): string {
  return encodeUnsafeChars(titleToSlug(title));
}

// Decodes a URL path segment back into its raw slug form, so it can
// be compared against titleToSlug(card.title) for every candidate
// card in the pod (see CardForm.tsx).
export function segmentToSlug(segment: string): string {
  return decodeURIComponent(segment);
}

// Best-effort reverse of titleToSlug, used when a URL's cardSlug
// matches no existing card (see CardForm.tsx): reconstructs a title
// candidate to pre-fill a new draft with, so opening /:pod/test seeds
// the header with "test" instead of showing "not found".
//
// This is NOT a true inverse of titleToSlug: an underscore in `slug`
// could originally have come from either a literal underscore or a
// space in the title, and this always resolves it to a space. That
// means a title can no longer be seeded with a literal underscore via
// the URL alone -- an accepted limitation.
export function slugToTitle(slug: string): string {
  return slug.replaceAll("_", " ");
}

// Mirrors internal/slug.ToLowerKey as the server applies it to a wiki link's
// target (see internal/wikilink's orderedTargets): bracket markup is stripped
// first, then the text is lowercased and spaces become underscores. This is
// the key a link is matched to a card by (cards.titleLc, card_links
// .target_titleLc).
export function titleToLowerKey(title: string): string {
  const base = /[[\]]/.test(title) ? splitWords(title).join(" ") : title;
  return base.toLowerCase().replaceAll(" ", "_");
}
