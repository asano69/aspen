package parser

import "unicode/utf8"


// parseHashTag mirrors frontend rules/hashTag.ts: a "#" at the start of the
// text or right after whitespace starts a tag that runs until
//   - whitespace;
//   - a "[" that opens a node of its own (any other "[" makes the whole run
//     plain text);
//   - a "]": inside a decoration or a strong (nested) it ends the tag,
//     anywhere else the whole run is plain text;
//   - a "`" that opens a code span (an unclosed one is part of the tag).
//
// A tag needs at least one character. The node's Text is the tag without its
// "#".
func parseHashTag(s string, pos int, nested bool) (*Node, int) {
	if pos > 0 {
		if prev, _ := utf8.DecodeLastRuneInString(s[:pos]); !isJSSpace(prev) {
			return nil, 0
		}
	}

	end := pos + 1
	for end < len(s) {
		r, width := utf8.DecodeRuneInString(s[end:])
		stop := false
		switch {
		case isJSSpace(r):
			stop = true
		case r == ']':
			if !nested {
				return nil, 0
			}
			stop = true
		case r == '[':
			if n, _ := parseBracket(s, end, nested); n == nil {
				return nil, 0
			}
			stop = true
		case r == '`':
			stop = codeSpanClose(s, end) >= 0
		}
		if stop {
			break
		}
		end += width
	}
	if end == pos+1 || tooLongForLink(s[pos+1:end]) {
		return nil, 0
	}
	return &Node{Kind: KindHashTag, Text: s[pos+1 : end]}, end
}
