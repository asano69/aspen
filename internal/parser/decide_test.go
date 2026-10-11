package parser

import "testing"

func TestDecideBracket(t *testing.T) {
	cases := []struct {
		content string
		kind    Kind
		src     string
	}{
		{"$ x", KindMath, ""}, {"me.icon*3", KindIcon, ""}, {"/project/page", KindProjectLink, ""},
		{"N35.68,E139.76,Z14", KindGoogleMap, ""}, {"page", KindWikiLink, ""},
		{"https://example.com/", KindExternalLink, ""}, {"https://example.com/a.png", KindImage, "https://example.com/a.png"},
		{"https://example.com/a.png https://example.com/b.jpg", KindLinkedImage, "https://example.com/a.png"},
		{"https://example.com/ https://example.com/a.png", KindLinkedImage, "https://example.com/a.png"},
		{"https://example.com/a.png label", KindWikiLink, ""}, {"label https://example.com/", KindExternalLink, ""},
		{"https://example.com/images?q=abc&s=10.png", KindImage, "https://example.com/images?q=abc&s=10.png"},
		{"https://example.com/page?file=a.png&x=1", KindExternalLink, ""},
		{"aaa\u3000https://example.com/", KindExternalLink, ""},
		{"https://example.com/\u3000aaa", KindExternalLink, ""},
		{"日本語\u3000タイトル", KindWikiLink, ""},
		{"@/abc123def456ghi/a.png", KindImage, "@/abc123def456ghi/a.png"},
		{"@/abc123def456ghi/a.png https://example.com/", KindLinkedImage, "@/abc123def456ghi/a.png"},
		{"@/abc123def456ghi/a.pdf", KindWikiLink, ""},
	}
	for _, tt := range cases {
		if got := DecideBracket(tt.content); got.Kind != tt.kind || got.Src != tt.src {
			t.Errorf("DecideBracket(%q) = %#v, want Kind=%q Src=%q", tt.content, got, tt.kind, tt.src)
		}
	}
}

func TestIndentHelpers(t *testing.T) {
	depth, offset := measureIndent("\t\u3000 x")
	if depth != 3 || offset != len("\t\u3000 ") {
		t.Errorf("measureIndent() = (%d, %d), want (3, %d)", depth, offset, len("\t\u3000 "))
	}
	if !isBlank("\uFEFF\u3000") || isBlank("\u0085") {
		t.Error("isBlank did not use ECMAScript whitespace")
	}
}
