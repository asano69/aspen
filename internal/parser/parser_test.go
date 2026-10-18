package parser

import (
	"slices"
	"strings"
	"testing"
)

const testTitle = "T\n"

func TestLongLinkTitleIsPlain(t *testing.T) {
	// The database cannot store a link title longer than 240 characters.
	// Characters are counted as code points, not bytes or UTF-16 units.
	for _, char := range []string{"a", "あ", "😀"} {
		ok := strings.Repeat(char, 240)
		long := strings.Repeat(char, 241)
		for _, form := range []string{"[%]", "#%"} {
			link := func(title string) []string {
				return Parse(testTitle + strings.Replace(form, "%", title, 1)).LinkTitles()
			}
			if got := link(ok); !slices.Equal(got, []string{ok}) {
				t.Errorf("%s x240: got %d titles, want 1", form, len(got))
			}
			if got := link(long); got != nil {
				t.Errorf("%s x241: got %d titles, want none", form, len(got))
			}
		}
	}
	// A URL link has no stored title, so it is not limited.
	line := Parse(testTitle + "[https://e.com/" + strings.Repeat("a", 300) + "]").Nodes[1]
	if len(line.Children) != 1 || line.Children[0].Kind != KindExternalLink {
		t.Errorf("long URL link = %v, want one external link", line.Children)
	}
}

func TestParseLinkTitles(t *testing.T) {
	cases := []struct {
		name string
		text string
		want []string
	}{
		{"plain, duplicate, and Unicode", testTitle + "[page] [page] [日本語]", []string{"page", "page", "日本語"}},
		{"title is raw text", "[not a link]\n[page]", []string{"page"}},
		{"inline code", testTitle + "`[hidden]` [shown]", []string{"shown"}},
		{"code block", testTitle + "before [a]\ncode:x\n\t[hidden]\nafter [b]", []string{"a", "b"}},
		{"decoration and strong", testTitle + "[* [a]] [[strong [b]]] [[https://example.com/a.png]] [[me.icon]]", []string{"a", "b"}},
		{"bracket kinds are not links", testTitle + "[ ] [$ x] [me.icon] [/project/a] [N35.6,E139.7] [https://example.com/] [https://example.com/a.png]", nil},
		{"nested and malformed brackets", testTitle + "[a [b] c] [unterminated [page]", []string{"b", "page"}},
		{"bracket containing code is plain", testTitle + "[`a`] [* `b`] [[`c`]] [a [`x`] b] [d]", []string{"d"}},
		{"bracket containing blank is plain", testTitle + "[a [ ] b] [[ ]] [* [ ]] [c]", []string{"c"}},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := Parse(tt.text).LinkTitles(); !slices.Equal(got, tt.want) {
				t.Errorf("LinkTitles() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestTitleAndBlocks(t *testing.T) {
	cases := []struct {
		name, text, title, tree string
	}{
		{"raw title", "  [raw]\n[page]", "  [raw]", "Document(Title,Line(link))"},
		{"blank first line has no title", " \u3000\n[page]", "", "Document(Line(link))"},
		{"code title stays title", "code:x\n\t[page]", "code:x", "Document(Title,Line(link))"},
		{"blank line ends code", testTitle + "code:x\n\t[hidden]\n\n[shown]", "T", "Document(Title,CodeBlock,Line(link))"},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			note := Parse(tt.text)
			if got := note.Title(); got != tt.title {
				t.Errorf("Title() = %q, want %q", got, tt.title)
			}
			if got := note.String(); got != tt.tree {
				t.Errorf("String() = %q, want %q", got, tt.tree)
			}
		})
	}
}

func TestCodeBlockBodyAndLineRange(t *testing.T) {
	// Lines: 0 title, 1 before, 2 declaration, 3-5 body, 6 after.
	text := testTitle + "before\n\tcode:main.rs(rust)\n\t\tfn main() {\n\t\t\t\u3000x\n\t\t}\nafter"
	nodes := Parse(text).Nodes
	if len(nodes) != 4 {
		t.Fatalf("got %d nodes, want 4", len(nodes))
	}

	code := nodes[2]
	if code.Kind != KindCodeBlock || code.Text != "main.rs(rust)" {
		t.Errorf("code node = %q %q", code.Kind, code.Text)
	}
	if code.StartLine != 2 || code.EndLine != 6 {
		t.Errorf("range = [%d, %d), want [2, 6)", code.StartLine, code.EndLine)
	}
	// Only the block's own indent level is removed; deeper whitespace stays.
	want := []string{"fn main() {", "\t\u3000x", "}"}
	if !slices.Equal(code.Body, want) {
		t.Errorf("Body = %q, want %q", code.Body, want)
	}

	if nodes[1].StartLine != 1 || nodes[1].EndLine != 2 {
		t.Errorf("line range = [%d, %d), want [1, 2)", nodes[1].StartLine, nodes[1].EndLine)
	}
	if nodes[3].StartLine != 6 || nodes[3].EndLine != 7 {
		t.Errorf("line range = [%d, %d), want [6, 7)", nodes[3].StartLine, nodes[3].EndLine)
	}
}

func TestCodeBlockBodyIsRelativeToDeclaration(t *testing.T) {
	// The declaration's own nesting must not leak into the code, or Python
	// would fail with "unexpected indent". The same code gives the same Body
	// at any depth.
	cases := []string{
		"code:py\n\tdef f():\n\t\treturn 1",
		"\tcode:py\n\t\tdef f():\n\t\t\treturn 1",
		"\u3000\u3000code:py\n\u3000\u3000\u3000def f():\n\u3000\u3000\u3000\treturn 1",
	}
	want := []string{"def f():", "\treturn 1"}
	for _, c := range cases {
		code := Parse(testTitle + c).Nodes[1] // nodes[0] is the title
		if !slices.Equal(code.Body, want) {
			t.Errorf("%q: Body = %q, want %q", c, code.Body, want)
		}
	}
}

func TestCodeBlockLanguage(t *testing.T) {
	cases := []struct {
		decl, text, lang string
	}{
		{"code:python", "python", "python"},
		{"code: python", "python", "python"}, // space after the colon is trimmed
		{"code:main.rs(rust)", "main.rs(rust)", "rust"},
		{"code:", "", ""},
	}
	for _, c := range cases {
		nodes := Parse(testTitle + c.decl + "\n\tx").Nodes
		code := nodes[1] // nodes[0] is the title
		if code.Kind != KindCodeBlock || code.Text != c.text || code.CodeLanguage() != c.lang {
			t.Errorf("%q: Text = %q, CodeLanguage() = %q, want %q / %q",
				c.decl, code.Text, code.CodeLanguage(), c.text, c.lang)
		}
	}
}

func TestDropRunes(t *testing.T) {
	cases := []struct {
		in   string
		n    int
		want string
	}{
		{"\t\tfoo", 2, "foo"},
		{"\u3000\u3000foo", 1, "\u3000foo"},
		{"ab", 2, ""},
		{"a", 3, ""},
	}
	for _, c := range cases {
		if got := dropRunes(c.in, c.n); got != c.want {
			t.Errorf("dropRunes(%q, %d) = %q, want %q", c.in, c.n, got, c.want)
		}
	}
}

func TestFirstImageSrc(t *testing.T) {
	cases := []struct{ text, want string }{
		{testTitle + "[https://example.com/a.png]", "https://example.com/a.png"},
		{testTitle + "[https://example.com/a.png https://example.com/b.jpg]", "https://example.com/a.png"},
		{testTitle + "[[https://example.com/a.png]]", "https://example.com/a.png"},
		{testTitle + "`[https://example.com/a.png]` [https://example.com/b.webp]", "https://example.com/b.webp"},
		{"[https://example.com/title.png]\n[https://example.com/body.gif]", "https://example.com/body.gif"},
	}
	for _, tt := range cases {
		if got := Parse(tt.text).FirstImageSrc(); got != tt.want {
			t.Errorf("FirstImageSrc(%q) = %q, want %q", tt.text, got, tt.want)
		}
	}
}

func TestCodeBlockBodyText(t *testing.T) {
	code := Parse(testTitle + "code:x\n\tgraph TD\n\t\tA-->B").Nodes[1]
	if got, want := code.BodyText(), "graph TD\n\tA-->B"; got != want {
		t.Errorf("BodyText() = %q, want %q", got, want)
	}
}

func TestImageWithExtensionInQuery(t *testing.T) {
	const src = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTr7Q2-iOUXeta4efD3d8FAPLTOfSN1lKRhOGJInoa6mA&s=10.png"

	if got := DecideBracket(src); got.Kind != KindImage || got.Src != src {
		t.Errorf("DecideBracket() = %#v, want Kind=%q Src=%q", got, KindImage, src)
	}
	if got := Parse(testTitle + "[" + src + "]").FirstImageSrc(); got != src {
		t.Errorf("FirstImageSrc() = %q, want %q", got, src)
	}
}

func TestWalkCanStop(t *testing.T) {
	count := 0
	finished := Parse(testTitle + "[a] [b]").Walk(func(*Node) bool {
		count++
		return false
	})
	if finished || count != 1 {
		t.Fatalf("Walk() = (%v, %d), want (false, 1)", finished, count)
	}
}
