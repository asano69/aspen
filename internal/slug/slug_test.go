package slug

import "testing"

func TestFromTitle_BracketsBecomeUnderscores(t *testing.T) {
	got := FromTitle("[foo]bar[baz]")
	want := "foo_bar_baz"
	if got != want {
		t.Errorf("FromTitle(...) = %q, want %q", got, want)
	}
}

func TestFromTitle_CollapsesConsecutiveSeparators(t *testing.T) {
	got := FromTitle("  [a][b]  c   d  ")
	want := "a_b_c_d"
	if got != want {
		t.Errorf("FromTitle(...) = %q, want %q", got, want)
	}
}

func TestStripBracketLinks(t *testing.T) {
	cases := []struct {
		candidate string
		want      string
	}{
		{"[A B[X]C D]", "A B X C D"},
		{"[A[XB]", "A XB"},
		{"[[[A[[B]]]", "A B"}, // consecutive brackets collapse into one boundary
		{"[A[]]", "A"},
		{"[[]]", ""}, // no words at all -- caller applies its own fallback
		{"[A[[[C]", "A C"},
		{"[D]", "D"},
	}
	for _, c := range cases {
		if got := StripBracketLinks(c.candidate); got != c.want {
			t.Errorf("StripBracketLinks(%q) = %q, want %q", c.candidate, got, c.want)
		}
	}
}

func TestStripBracketLinks_OnlyBracketsAndSpacesSeparate(t *testing.T) {
	cases := []struct {
		candidate string
		want      string
	}{
		{"abc[]", "abc"},
		{"[]abc", "abc"},
		{"a [] b", "a b"},
		{"[ ]", ""},
		{"[* bold]", "* bold"},      // decorations are not interpreted
		{"[a\tb]", "a\tb"},          // a tab is not a separator
		{"[a\u3000b]", "a\u3000b"}, // neither is a full-width space
	}
	for _, c := range cases {
		if got := StripBracketLinks(c.candidate); got != c.want {
			t.Errorf("StripBracketLinks(%q) = %q, want %q", c.candidate, got, c.want)
		}
	}
}

func TestFromTitle_ReservedWordGetsSuffixed(t *testing.T) {
	if got := FromTitle("new"); got != "new_" {
		t.Errorf("FromTitle(\"new\") = %q, want %q", got, "new_")
	}
	// Case sensitivity: only an exact match is reserved.
	if got := FromTitle("New"); got != "New" {
		t.Errorf("FromTitle(\"New\") = %q, want %q", got, "New")
	}
}

func TestFromTitle_LeavesTabUntouched(t *testing.T) {
	// Tab is not in the [\[\] ] separator class (only brackets and the
	// literal ASCII space match), so it must pass through unchanged --
	// mirrors frontend/src/lib/slugify.ts's titleToSlug. Turning it
	// into a URL-safe "%09" is the frontend's job (titleToSegment's
	// encodeUnsafeChars), not this function's.
	got := FromTitle("A\tB")
	want := "A\tB"
	if got != want {
		t.Errorf("FromTitle(%q) = %q, want %q", "A\tB", got, want)
	}
}

func TestFromTitle_LeavesFullWidthSpaceUntouched(t *testing.T) {
	// U+3000 (full-width space) is not the ASCII space character, so
	// it isn't treated as a word separator -- mirrors
	// frontend/src/lib/slugify.ts's splitWords.
	got := FromTitle("A\u3000B")
	want := "A\u3000B"
	if got != want {
		t.Errorf("FromTitle(%q) = %q, want %q", "A\u3000B", got, want)
	}
}

func TestIsReserved(t *testing.T) {
	cases := []struct {
		title string
		want  bool
	}{
		{"new", true},
		{"New", true},
		{"NEW", true},
		{"nEw", true},
		{"neW", true},
		{"NeW", true},
		{"nEW", true},
		{"NEw", true},
		{"News", false},
		{"new_spaper", false},
		{"newspaper", false},
		{" new", false},
		{"new ", false},
	}
	for _, c := range cases {
		if got := IsReserved(c.title); got != c.want {
			t.Errorf("IsReserved(%q) = %v, want %v", c.title, got, c.want)
		}
	}
}
