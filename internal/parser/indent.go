package parser

import (
	"strings"
	"unicode"
)

// isJSSpace reports whether r matches ECMAScript's \s. It mirrors the
// frontend parser's indent.ts; unicode.IsSpace is deliberately not used.
func isJSSpace(r rune) bool {
	return unicode.Is(unicode.Zs, r) || strings.ContainsRune("\t\n\v\f\r\u2028\u2029\uFEFF", r)
}

// IsSpace reports whether r is ECMAScript whitespace (\s), the parser's
// definition of a word separator.
func IsSpace(r rune) bool { return isJSSpace(r) }

// TrimSpace removes leading and trailing ECMAScript whitespace (\s) from s, so
// a full-width space or a tab at either end is dropped like an ASCII space.
func TrimSpace(s string) string { return strings.TrimFunc(s, isJSSpace) }

// measureIndent returns leading ECMAScript-whitespace character count and the
// byte offset immediately after it.
func measureIndent(line string) (depth, offset int) {
	for i, r := range line {
		if !isJSSpace(r) {
			return depth, i
		}
		depth++
	}
	return depth, len(line)
}

// dropRunes returns s without its first n characters (not bytes). It returns
// an empty string when s has fewer than n characters.
func dropRunes(s string, n int) string {
	for i := range s {
		if n == 0 {
			return s[i:]
		}
		n--
	}
	return ""
}

// isBlank reports whether s is empty or consists solely of ECMAScript space.
func isBlank(s string) bool {
	_, offset := measureIndent(s)
	return offset == len(s)
}
