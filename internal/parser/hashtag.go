package parser

import "unicode/utf8"

// parseHashTag mirrors frontend rules/hashTag.ts: a "#" at the start of the
// text or right after whitespace, followed by a non-space character, runs up
// to the next whitespace. Inside a decoration or a strong (nested) it also
// stops at "]", which belongs to the enclosing bracket. The node's Text is the
// tag without its "#".
func parseHashTag(s string, pos int, nested bool) (*Node, int) {
	if pos > 0 {
		if prev, _ := utf8.DecodeLastRuneInString(s[:pos]); !isJSSpace(prev) {
			return nil, 0
		}
	}
	end := scanUntil(s, pos+1, func(r rune) bool {
		return isJSSpace(r) || (nested && r == ']')
	})
	if end == pos+1 || tooLongForLink(s[pos+1:end]) {
		return nil, 0
	}
	return &Node{Kind: KindHashTag, Text: s[pos+1 : end]}, end
}
