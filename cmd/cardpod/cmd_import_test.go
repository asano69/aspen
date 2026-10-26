package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestConfirm(t *testing.T) {
	cases := []struct {
		input string
		want  bool
	}{
		{"y\n", true},
		{"YES\n", true},
		{" yes \n", true},
		{"y", true}, // EOF without a newline
		{"\n", false},
		{"n\n", false},
		{"yep\n", false},
		{"", false},
	}
	for _, c := range cases {
		var out bytes.Buffer
		got, err := confirm(strings.NewReader(c.input), &out, "ok?")
		if err != nil || got != c.want {
			t.Errorf("confirm(%q) = (%v, %v), want %v", c.input, got, err, c.want)
		}
		if !strings.Contains(out.String(), "ok? [y/N]") {
			t.Errorf("prompt = %q, want the question with [y/N]", out.String())
		}
	}
}
