// The "card_links" collection cannot store a target title longer than this
// many characters, so a longer wiki link or hashtag is plain text. Keep in
// sync with maxLinkTitleRunes in internal/parser/linktitle.go.
const MAX_LINK_TITLE_LENGTH = 240;

// Counts code points, not UTF-16 units, like the database does.
export function isLinkTitleTooLong(title: string): boolean {
  return [...title].length > MAX_LINK_TITLE_LENGTH;
}
