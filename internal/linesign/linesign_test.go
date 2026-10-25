package linesign

import (
	"crypto/ed25519"
	"encoding/base64"
	"path/filepath"
	"testing"
	"unicode/utf16"

	"github.com/asano69/cardpod/internal/lineid"
)

func units(s string) []uint16 { return utf16.Encode([]rune(s)) }

func loadTestSigner(t *testing.T) *Signer {
	t.Helper()
	s, err := Load(filepath.Join(t.TempDir(), "server_key.pem"))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSignRecordsUserAndVerifies(t *testing.T) {
	s := loadTestSigner(t)
	doc := units("a\nb")
	lines := lineid.New(2, 1)

	for _, l := range s.Sign(doc, lines, "bob@example.com", 5) {
		if l.User != "bob@example.com" || l.Key != s.PublicKey() || l.Updated != 5 || l.Hash == "" {
			t.Fatalf("line not filled in: %+v", l)
		}
		sig, err := base64.StdEncoding.DecodeString(l.Signature)
		if err != nil {
			t.Fatal(err)
		}
		if !ed25519.Verify(s.key.Public().(ed25519.PublicKey), message(l), sig) {
			t.Errorf("signature of %q does not verify", l.ID)
		}
	}
}

func TestSignKeepsUnchangedLines(t *testing.T) {
	s := loadTestSigner(t)
	first := s.Sign(units("a\nb"), lineid.New(2, 1), "bob@example.com", 5)

	second := s.Sign(units("a\nc"), first, "alice@example.com", 9)
	if second[0] != first[0] {
		t.Errorf("unchanged line was signed again: %+v", second[0])
	}
	if l := second[1]; l.User != "alice@example.com" || l.Updated != 9 || l.Hash == first[1].Hash {
		t.Errorf("changed line was not signed again: %+v", l)
	}
}

func TestLoadKeepsTheGeneratedKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server_key.pem")
	a, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	b, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if a.PublicKey() != b.PublicKey() {
		t.Error("the key changed between two loads")
	}
}
