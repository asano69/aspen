package slug

import "testing"

func TestTruncateRunes(t *testing.T) {
	cases := []struct {
		in   string
		n    int
		want string
	}{
		{"abc", 5, "abc"},
		{"abc", 3, "abc"},
		{"abcd", 3, "abc"},
		{"あいうえ", 2, "あい"},
		{"😀😀😀", 2, "😀😀"},
	}
	for _, c := range cases {
		if got := TruncateRunes(c.in, c.n); got != c.want {
			t.Errorf("TruncateRunes(%q, %d) = %q, want %q", c.in, c.n, got, c.want)
		}
	}
}
