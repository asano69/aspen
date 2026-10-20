// Package parser parses the subset of Cardpod's Scrapbox-compatible syntax
// needed by backend services. Its rules mirror the frontend parser/cardpod
// rules and should be kept in lockstep with them.
package parser

import (
	"regexp"
	"strings"
)

// Kind identifies what a Node represents.
type Kind string

const (
	KindTitle     Kind = "Title"
	KindLine      Kind = "Line"
	KindCodeBlock Kind = "CodeBlock"
	KindQuote     Kind = "quote"
	KindTable     Kind = "Table"

	KindInlineCode Kind = "code"
	KindDecoration Kind = "deco"
	KindStrong     Kind = "strong"
	KindBlank      Kind = "blank"
	KindHashTag    Kind = "hashTag"
	KindBareURL    Kind = "url"

	KindWikiLink     Kind = "link"
	KindImage        Kind = "image"
	KindLinkedImage  Kind = "imageLink"
	KindExternalLink Kind = "urlLink"
	KindMath         Kind = "Math"
	KindIcon         Kind = "icon"
	KindProjectLink  Kind = "ProjectLink"
	KindGoogleMap    Kind = "location"
)

// Node is a notation found in a card. Only Line, Quote, Table, Decoration,
// and Strong have children (a Table's children are
// the inline nodes of all its cells). Text holds the raw title, wiki-link
// title, hashtag title (without the leading "#"), image source, raw bracket
// content, or a code block's declaration after "code:" (for example
// "main.rs(rust)"), according to Kind.
type Node struct {
	Kind     Kind
	Text     string
	Children []*Node

	// StartLine and EndLine are the 0-based, half-open line range
	// [StartLine, EndLine) of a top-level block node in the card text.
	// Blank lines belong to no node. They are not set on inline nodes.
	StartLine, EndLine int

	// Body holds the body lines of a CodeBlock, one entry per source line
	// (so len(Body) == EndLine-StartLine-1). The declaration's indent plus
	// one character is removed from each line; any deeper whitespace is part
	// of the code and is kept.
	Body []string

	// Line, Start and End locate an inline node: its 0-based line in the card
	// text and its byte range [Start, End) within that line. They are not set
	// on block nodes.
	Line, Start, End int
}

// String renders a node's tree shape.
func (n *Node) String() string {
	if len(n.Children) == 0 {
		return string(n.Kind)
	}
	parts := make([]string, len(n.Children))
	for i, child := range n.Children {
		parts[i] = child.String()
	}
	return string(n.Kind) + "(" + strings.Join(parts, ",") + ")"
}

// codeLangRe matches an explicit language in parentheses at the end of a code
// declaration, as in "main.rs(rust)". Keep in sync with frontend
// codeLanguages.ts.
var codeLangRe = regexp.MustCompile(`\(([^()]+)\)$`)

// CodeLanguage returns the language of a CodeBlock: the text in trailing
// parentheses when present ("main.rs(rust)" -> "rust"), otherwise the whole
// declaration ("python" -> "python"). It is empty for a bare "code:".
func (n *Node) CodeLanguage() string {
	if m := codeLangRe.FindStringSubmatch(n.Text); m != nil {
		if lang := strings.TrimSpace(m[1]); lang != "" {
			return lang
		}
	}
	return n.Text
}

// BodyText returns the body lines of a CodeBlock joined into one string.
func (n *Node) BodyText() string {
	return strings.Join(n.Body, "\n")
}

func walkNodes(nodes []*Node, fn func(*Node) bool) bool {
	for _, n := range nodes {
		if !fn(n) || !walkNodes(n.Children, fn) {
			return false
		}
	}
	return true
}
