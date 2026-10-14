package parser

import (
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Decision is the classification of a non-empty bracket notation.
type Decision struct {
	Kind Kind
	Src  string
	// Label is the part of a labelled external link that is not its URL.
	Label string
	// URLFirst is true when the URL of a labelled external link comes first
	// ("[https://e.com label]"), false when it comes last ("[label https://e.com]").
	URLFirst bool
}

var (
	iconRe       = regexp.MustCompile(`^.+\.icon(?:\*[1-9]\d*)?$`)
	projectRe    = regexp.MustCompile(`^/[^/]+(?:/.*)?$`)
	coordinateRe = regexp.MustCompile(`^[NS]\d+(?:\.\d+)?,[EW]\d+(?:\.\d+)?(?:,Z\d+)?$`)
	gyazoRe      = regexp.MustCompile(`(?i)^https?://(?:[0-9a-z-]+\.)?gyazo\.com/[0-9a-f]{32}(?:/raw)?$`)
	// Matched against the whole URL so that a trailing ".png" in the query
	// or fragment counts too; keep in sync with frontend rules/bracket.ts.
	imageExtRe = regexp.MustCompile(`(?i)\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)(?:[?#].*)?$`)
	// An uploaded attachment, written relative to the origin as
	// "@/<recordId>/<filename>"; keep in sync with frontend rules/bracket.ts.
	attachmentRe = regexp.MustCompile(`^@/[a-z0-9]+/[^\s/]+$`)
)

type urlKind int

const (
	urlNone urlKind = iota
	urlImage
	urlLink
)

func inferURL(value string) urlKind {
	if attachmentRe.MatchString(value) && imageExtRe.MatchString(value) {
		return urlImage
	}
	if !strings.Contains(value, "://") {
		return urlNone
	}
	// Only http(s) URLs count, like the frontend: "[ftp://x]" is a wiki link.
	u, err := url.Parse(value)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return urlNone
	}
	if gyazoRe.MatchString(value) || imageExtRe.MatchString(value) {
		return urlImage
	}
	return urlLink
}

// DecideBracket classifies non-empty bracket content using the same ordering
// as the frontend bracket rule.
func DecideBracket(content string) Decision {
	if strings.HasPrefix(content, "$ ") {
		return Decision{Kind: KindMath}
	}
	if iconRe.MatchString(content) {
		return Decision{Kind: KindIcon}
	}
	if projectRe.MatchString(content) {
		return Decision{Kind: KindProjectLink}
	}

	// Any ECMAScript whitespace separates tokens; keep in sync with
	// frontend rules/bracket.ts.
	firstSpace := strings.IndexFunc(content, isJSSpace)
	lastSpace := strings.LastIndexFunc(content, isJSSpace)
	first, rest, last := content, "", ""
	if firstSpace >= 0 {
		_, firstWidth := utf8.DecodeRuneInString(content[firstSpace:])
		_, lastWidth := utf8.DecodeRuneInString(content[lastSpace:])
		first = content[:firstSpace]
		rest = content[firstSpace+firstWidth:]
		last = content[lastSpace+lastWidth:]
	}
	if coordinateRe.MatchString(content) || coordinateRe.MatchString(first) || coordinateRe.MatchString(last) {
		return Decision{Kind: KindGoogleMap}
	}

	firstKind := inferURL(first)
	if firstSpace < 0 {
		switch firstKind {
		case urlImage:
			return Decision{Kind: KindImage, Src: first}
		case urlLink:
			return Decision{Kind: KindExternalLink}
		}
		return Decision{Kind: KindWikiLink}
	}

	lastKind := inferURL(last)
	if firstSpace == lastSpace && firstKind != urlNone && lastKind != urlNone && (firstKind == urlImage || lastKind == urlImage) {
		src := last
		if firstKind == urlImage {
			src = first
		}
		return Decision{Kind: KindLinkedImage, Src: src}
	}
	if firstKind == urlLink {
		return Decision{Kind: KindExternalLink, Label: rest, URLFirst: true}
	}
	if lastKind != urlNone {
		return Decision{Kind: KindExternalLink, Label: content[:lastSpace]}
	}
	return Decision{Kind: KindWikiLink}
}
