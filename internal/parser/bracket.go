package parser

import "strings"

// decoChars are the characters accepted as decoration marks. Keep in sync
// with DECO_CHARS in frontend rules/decoration.ts.
const decoChars = `!"#%&'()*+,-./{|}<>_~`

// bracketContainsCode mirrors frontend rules/bracketCode.ts: it reports
// whether a code span or a blank starts before the bracket opening at pos
// closes. Whichever starts first wins.
func bracketContainsCode(s string, pos int) bool {
	depth := 0
	for i := pos + 1; i < len(s); i++ {
		switch s[i] {
		case '[':
			if n, _ := parseBlank(s, i); n != nil {
				return true
			}
			depth++
		case ']':
			if depth == 0 {
				return false
			}
			depth--
		case '`':
			if codeSpanClose(s, i) >= 0 {
				return true
			}
		}
	}
	return false
}

// parseBracket mirrors the frontend decoration, blank, and bracket rules.
// A bracket containing a code span or a blank is plain text. nested is true
// inside a decoration or a strong: neither can start there, so "[* [* a]]" is
// a decoration holding the link "* a".
func parseBracket(s string, pos int, nested bool) (*Node, int) {
	if bracketContainsCode(s, pos) {
		return nil, 0
	}
	if !nested {
		if n, end := parseDecoration(s, pos); n != nil {
			return n, end
		}
	}
	if n, end := parseBlank(s, pos); n != nil {
		return n, end
	}
	if !nested && pos+1 < len(s) && s[pos+1] == '[' {
		if n, end := parseStrong(s, pos); n != nil {
			return n, end
		}
	}
	return parseSingle(s, pos)
}

// matchingBracket returns the "]" that closes the bracket whose content
// starts at from, counting nested brackets. Only a formula ("[$ ...]") is
// closed this way; every other notation closes at its first "]".
func matchingBracket(s string, from int) int {
	depth := 0
	for i := from; i < len(s); i++ {
		switch s[i] {
		case '[':
			depth++
		case ']':
			if depth == 0 {
				return i
			}
			depth--
		}
	}
	return -1
}

// lastOfRun returns the index of the last "]" of the run of "]" that
// contains i.
func lastOfRun(s string, i int) int {
	for i+1 < len(s) && s[i+1] == ']' {
		i++
	}
	return i
}

// decoMarkEnd returns the index right after the "<deco chars>+ " that
// starts at i, or -1 when there is none.
func decoMarkEnd(s string, i int) int {
	from := i
	for i < len(s) && strings.IndexByte(decoChars, s[i]) >= 0 {
		i++
	}
	if i == from || i >= len(s) || s[i] != ' ' {
		return -1
	}
	return i + 1
}

func parseDecoration(s string, pos int) (*Node, int) {
	from := decoMarkEnd(s, pos+1)
	if from < 0 {
		return nil, 0
	}
	end := decoClose(s, from)
	if end <= from {
		return nil, 0
	}
	children := parseInlineIn(s[from:end], true)
	shift(children, from)
	return &Node{Kind: KindDecoration, Children: children}, end + 1
}

// decoClose returns the "]" that closes a decoration whose content starts at
// from, or -1. The content is parsed as inline text, so a "]" that belongs to
// a nested notation does not close it: the first "]" outside every nested
// notation does. When there is none, the "]" of the last nested notation
// closes instead ("[* a [b]" is the decoration "a [b").
func decoClose(s string, from int) int {
	nodes := parseInlineIn(s[from:], true)
	shift(nodes, from)

	next := 0
	for i := from; i < len(s); i++ {
		for next < len(nodes) && nodes[next].End <= i {
			next++
		}
		if next < len(nodes) && nodes[next].Start <= i {
			continue // inside a nested notation
		}
		if s[i] == ']' {
			return i
		}
	}
	for k := len(nodes) - 1; k >= 0; k-- {
		if s[nodes[k].End-1] == ']' {
			return nodes[k].End - 1
		}
	}
	return -1
}

func parseBlank(s string, pos int) (*Node, int) {
	end := strings.IndexByte(s[pos+1:], ']')
	if end <= 0 || !isBlank(s[pos+1:pos+1+end]) {
		return nil, 0
	}
	return &Node{Kind: KindBlank}, pos + end + 2
}

func parseStrong(s string, pos int) (*Node, int) {
	from := pos + 2
	end := strongClose(s, from)
	if end <= from {
		return nil, 0
	}
	content := s[from:end]
	// "[[* a]]" is a decoration inside brackets, not a strong. An empty
	// body ("[[* ]]") is not a decoration, so it stays a strong.
	if end := decoMarkEnd(content, 0); end >= 0 && end < len(content) {
		return nil, 0
	}
	decision := DecideBracket(content)
	children := parseInlineIn(content, true)
	shift(children, from)
	if decision.Kind == KindImage || decision.Kind == KindIcon {
		children = []*Node{bracketNode(decision, content)}
	}
	return &Node{Kind: KindStrong, Children: children}, end + 2
}

// strongClose returns the first "]" of the "]]" that closes a strong whose
// content starts at from, or -1. The closing "]]" is the last two "]" of a run
// of "]", so "[[a]]]" is the strong "a]". The content may hold links but no
// stray "[" and no decoration.
func strongClose(s string, from int) int {
	for i := from; i < len(s); {
		switch s[i] {
		case '[':
			if decoMarkEnd(s, i+1) >= 0 {
				return -1
			}
			_, end, ok := singleSpan(s, i)
			if !ok {
				return -1
			}
			i = end + 1
		case ']':
			last := lastOfRun(s, i)
			if last > i {
				return last - 1
			}
			i++
		case 'h':
			// A URL may hold "[".
			if n, end := parseBareURL(s, i); n != nil {
				i = end
			} else {
				i++
			}
		default:
			i++
		}
	}
	return -1
}

// singleSpan finds the "]" that closes the single bracket opening at pos and
// classifies its content. ok is false when the bracket is plain text.
//
// A single bracket closes at its first "]", so its content has no "[": "[x [y]]"
// is the plain "[x " followed by the link "y". The exception is an external
// link, whose label is plain text and may hold "[": "[https://e.com a [b]]".
// When its URL comes first, the link closes at the last "]" of the run.
func singleSpan(s string, pos int) (d Decision, close int, ok bool) {
	isMath := strings.HasPrefix(s[pos+1:], "$ ")
	if isMath {
		close = matchingBracket(s, pos+1)
	} else if close = strings.IndexByte(s[pos+1:], ']'); close >= 0 {
		close += pos + 1
	}
	if close < 0 || close == pos+1 {
		return d, 0, false
	}

	content := s[pos+1 : close]
	d = DecideBracket(content)
	if !isMath && strings.Contains(content, "[") && d.Kind != KindExternalLink {
		return d, 0, false
	}
	if d.Kind == KindWikiLink && tooLongForLink(content) {
		return d, 0, false
	}
	if d.URLFirst {
		close = lastOfRun(s, close)
		d = DecideBracket(s[pos+1 : close])
	}
	return d, close, true
}

func parseSingle(s string, pos int) (*Node, int) {
	d, close, ok := singleSpan(s, pos)
	if !ok {
		return nil, 0
	}
	return bracketNode(d, s[pos+1:close]), close + 1
}

// bracketNode builds the node of a classified bracket. The label of an
// external link is plain text, so no notation inside it is parsed.
func bracketNode(decision Decision, content string) *Node {
	if decision.Kind == KindImage || decision.Kind == KindLinkedImage {
		return &Node{Kind: decision.Kind, Text: decision.Src}
	}
	return &Node{Kind: decision.Kind, Text: content}
}
