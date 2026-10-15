// frontend/src/lib/models/card.ts
//
// Card domain types, consolidated in one place: a title candidate's
// raw text and how it resolves into a card's stored title (see
// internal/serve/slug.go), and the two derived forms other code
// consumes (CardRecord's "title" field, CardGridTitle for the grid).
// Keeping the whole chain in one file means it can be read start to
// end instead of jumping between separate files.

// A title candidate is text extracted from a card's live document
// (see noteEditor/titleCandidatePlugin.ts's extractCandidate) that
// has not yet been resolved into a real title by the server. Branded
// so a plain, unvalidated string -- e.g. a card's already-resolved
// `title` field below -- can't be passed anywhere a candidate is
// expected; only makeTitleCandidate() can produce one. The brand only
// exists at the TypeScript level: it's erased once the value crosses
// the network as a JSON request body (see lib/cardApi.ts), which is
// expected -- the server re-derives its own guarantees independently
// (see internal/serve/slug.go).
export type TitleCandidate = string & { readonly __brand: "TitleCandidate" };

// The only way to produce a TitleCandidate: trims the input first, so
// every candidate reaching the server is already whitespace-trimmed
// regardless of where it was extracted from.
export function makeTitleCandidate(text: string): TitleCandidate {
  return text.trim() as TitleCandidate;
}

// A card's genuine display title, as resolved and stored server-side
// (see internal/serve/ydoc.go's buildTitleAndPreview / resolveCardTitle).
// Branded so a plain, unvalidated string can't be passed anywhere a
// resolved card title is expected -- distinguishing it from a raw,
// unresolved TitleCandidate above, or from a card's slug.
export type CardTitle = string & { readonly __brand: "CardTitle" };

// Wraps a value already known to be a resolved card title, e.g. a
// PocketBase "cards" record's "title" field. Performs no validation of
// its own -- the server is the actual source of truth for title
// resolution/uniqueness (see internal/serve/slug.go).
export function asCardTitle(title: string): CardTitle {
  return title as CardTitle;
}

// Matches the PocketBase "cards" collection schema.
export interface CardRecord {
  id: string;
  title: CardTitle;
  // Case-insensitive key derived from the title (see internal/slug.ToLowerKey).
  // A wiki link is matched to a card by (pot, titleLc).
  titleLc: string;
  // The preview text, one entry per line (see descriptionLines in
  // internal/serve/ydoc.go). Null for a card that has none yet.
  description: string[] | null;
  image: string;
  pot: string;
  // Datalog query text (not evaluated yet). Optional because cards cached
  // in Dexie before this field existed do not have it.
  query?: string;
  // Soft-delete timestamp; an empty string while the card is live. The
  // frontend never lists or opens a card that has one.
  deleted: string;
  // Cards are listed by descending creation time.
  created: string;
  updated: string;
}

// The fields a card grid item displays. Cards that come from the links1hop /
// links2hop routes carry only these, so the grid view accepts this subset
// instead of a full CardRecord.
export type CardGridCard = Pick<CardRecord, "title" | "description" | "image">;

// A related card of the open card (see lib/dexie/relatedQuery.ts). The id is
// the key the grid is reconciled by.
export type RelatedCard = CardGridCard & { id: string };

// A row of the 2 hop view: a card that links to a target the open card links
// to as well. The field names match the server's Link2HopCard, so the view
// can group rows by via_titleLc as before.
export type RelatedHopCard = RelatedCard & {
  // The target as the open card spells it.
  via_title: string;
  via_titleLc: string;
};

// The title shown for a card in CardList's grid (see
// pages/cards/CardItem.tsx). Branded so call sites can't
// accidentally pass a card's genuine CardTitle directly where the
// grid-specific title is expected, in case grid-specific formatting
// (e.g. truncation) is ever added here.
export type CardGridTitle = string & { readonly __brand: "CardGridTitle" };

// Matches a run of one or more ASCII whitespace characters (space,
// tab, newline, ...). Deliberately NOT the same as JS's `\s`, which
// also matches Unicode space separators like the full-width space
// (U+3000) -- that's a distinct, intentional character in Japanese
// text, not whitespace noise to collapse away.
const ASCII_WHITESPACE_RUN_RE = /[ \t\n\r\f\v]+/g;

// Collapses any run of ASCII whitespace in `title` into a single
// half-width space. resolveTitle (internal/serve/slug.go) only strips
// bracket markup from a candidate before saving it as a title -- a
// stray tab or doubled space typed by the user can still end up
// stored verbatim -- so this is what keeps the grid showing one clean
// gap instead of a visible double space or literal tab character.
export function collapseGridTitleWhitespace(title: string): string {
  return title.replace(ASCII_WHITESPACE_RUN_RE, " ");
}

// Derives the grid title for `card`: its stored title with ASCII
// whitespace runs collapsed (see collapseGridTitleWhitespace above).
export function deriveCardGridTitle(
  card: Pick<CardRecord, "title">,
): CardGridTitle {
  return collapseGridTitleWhitespace(card.title) as CardGridTitle;
}
