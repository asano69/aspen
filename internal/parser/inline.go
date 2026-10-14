package parser

import "unicode/utf8"

// inlineRule mirrors the frontend parseInline rule contract.
type inlineRule func(s string, pos int) (n *Node, end int)

func parseInline(s string) []*Node {
	return parseInlineIn(s, false)
}

// parseInlineIn parses s. nested is true inside a decoration or a strong,
// where neither can start again (see parseBracket).
func parseInlineIn(s string, nested bool) []*Node {
	var nodes []*Node
	for pos := 0; pos < len(s); {
		n, end := parseAt(s, pos, nested)
		if n == nil || end <= pos {
			pos++
			continue
		}
		n.Start, n.End = pos, end
		nodes = append(nodes, n)
		pos = end
	}
	return nodes
}

func parseAt(s string, pos int, nested bool) (*Node, int) {
	switch s[pos] {
	case '[':
		return parseBracket(s, pos, nested)
	case '`':
		return parseInlineCode(s, pos)
	case '#':
		return parseHashTag(s, pos, nested)
	case 'h':
		return parseBareURL(s, pos)
	default:
		return nil, 0
	}
}

// scanUntil returns the index of the first character at or after from for
// which stop is true, or len(s) when there is none.
func scanUntil(s string, from int, stop func(rune) bool) int {
	for from < len(s) {
		r, width := utf8.DecodeRuneInString(s[from:])
		if stop(r) {
			break
		}
		from += width
	}
	return from
}

// shift moves the ranges of nodes, and of all their descendants, by delta
// bytes. A rule that parses a substring uses it to bring the children into
// the coordinates of the text the substring was cut from.
func shift(nodes []*Node, delta int) {
	for _, n := range nodes {
		n.Start += delta
		n.End += delta
		shift(n.Children, delta)
	}
}

// setLine records the line of nodes and of all their descendants.
func setLine(nodes []*Node, line int) {
	for _, n := range nodes {
		n.Line = line
		setLine(n.Children, line)
	}
}

var (
	_ inlineRule = parseInlineCode
	_ inlineRule = parseBareURL
)
