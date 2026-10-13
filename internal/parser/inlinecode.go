package parser

import "strings"

// codeSpanClose returns the index of the backtick that closes the code span
// opening at pos, or -1 when there is none.
func codeSpanClose(s string, pos int) int {
	end := strings.IndexByte(s[pos+1:], '`')
	if end < 0 {
		return -1
	}
	return pos + 1 + end
}

// parseInlineCode mirrors frontend rules/inlineCode.ts.
func parseInlineCode(s string, pos int) (*Node, int) {
	close := codeSpanClose(s, pos)
	if close < 0 {
		return nil, 0
	}
	return &Node{Kind: KindInlineCode}, close + 1
}
