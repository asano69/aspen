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
// A bracket containing a code span or a blank is plain text.
func parseBracket(s string, pos int) (*Node, int) {
	if bracketContainsCode(s, pos) {
		return nil, 0
	}
	if n, end := parseDecoration(s, pos); n != nil {
		return n, end
	}
	if n, end := parseBlank(s, pos); n != nil {
		return n, end
	}
	if pos+1 < len(s) && s[pos+1] == '[' {
		return parseStrong(s, pos)
	}
	return parseSingle(s, pos)
}

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

func parseDecoration(s string, pos int) (*Node, int) {
	i := pos + 1
	for i < len(s) && strings.IndexByte(decoChars, s[i]) >= 0 {
		i++
	}
	if i == pos+1 || i >= len(s) || s[i] != ' ' {
		return nil, 0
	}
	from := i + 1
	end := matchingBracket(s, from)
	if end < 0 || end == from {
		return nil, 0
	}
	children := parseInline(s[from:end])
	shift(children, from)
	return &Node{Kind: KindDecoration, Children: children}, end + 1
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
	innerEnd := matchingBracket(s, from)
	if innerEnd < 0 || innerEnd == from || innerEnd+1 >= len(s) || s[innerEnd+1] != ']' {
		return nil, 0
	}
	content := s[from:innerEnd]
	decision := DecideBracket(content)
	children := parseInline(content)
	shift(children, from)
	if decision.Kind == KindImage || decision.Kind == KindIcon {
		children = []*Node{bracketNode(decision, content)}
	}
	return &Node{Kind: KindStrong, Children: children}, innerEnd + 2
}

func parseSingle(s string, pos int) (*Node, int) {
	end := matchingBracket(s, pos+1)
	if end < 0 || end == pos+1 {
		return nil, 0
	}
	content := s[pos+1 : end]
	n := bracketNode(DecideBracket(content), content)
	shift(n.Children, pos+1) // the content starts right after "["
	return n, end + 1
}

func bracketNode(decision Decision, content string) *Node {
	if decision.Kind == KindImage || decision.Kind == KindLinkedImage {
		return &Node{Kind: decision.Kind, Text: decision.Src}
	}
	n := &Node{Kind: decision.Kind, Text: content}
	// The label of an external link is parsed like any other inline text, so
	// a wiki link or hashtag inside it is found.
	if decision.Label != "" {
		n.Children = parseInline(decision.Label)
		shift(n.Children, decision.LabelOffset)
	}
	return n
}
