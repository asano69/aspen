package parser

import "unicode/utf8"

// maxLinkTitleRunes is the longest title the "card_links" collection can
// store, so a longer wiki link or hashtag is plain text. Keep in sync with
// MAX_LINK_TITLE_LENGTH in frontend rules/linkTitle.ts.
const maxLinkTitleRunes = 240

// tooLongForLink reports whether title is too long to be a link target.
// Characters are counted as code points, like the database does.
func tooLongForLink(title string) bool {
	return utf8.RuneCountInString(title) > maxLinkTitleRunes
}
