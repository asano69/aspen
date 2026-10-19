package slug

import "unicode/utf8"

// MaxTitleRunes is the longest card title the "cards" collection can store
// (its titleLc is derived from the title, so it has the same limit).
const MaxTitleRunes = 240

// TruncateRunes cuts s to at most n runes (not bytes), so a title written in
// Japanese is never cut in the middle of a character.
func TruncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
