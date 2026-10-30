// Package linesign signs the lines of a card with the server's key, so that
// the "lines" field of card_contents acts as a detached signature of the text.
package linesign

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"slices"
	"unicode/utf16"

	"github.com/asano69/aspen/internal/lineid"
)

// Signer holds the signing key of the server.
type Signer struct {
	key       ed25519.PrivateKey
	publicKey string // PKIX DER, base64: the "key" of every line it signs
}

// Load reads the private key at path. A missing file is created with a new key.
func Load(path string) (*Signer, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return generate(path)
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("%s is not a PEM file", path)
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	priv, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("%s is not an ed25519 key", path)
	}
	return newSigner(priv)
}

// generate creates a new private key at path (PKCS#8 PEM, mode 0600).
func generate(path string) (*Signer, error) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate key: %w", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return nil, fmt.Errorf("encode key: %w", err)
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, fmt.Errorf("create %s: %w", path, err)
	}
	err = pem.Encode(f, &pem.Block{Type: "PRIVATE KEY", Bytes: der})
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(path)
		return nil, fmt.Errorf("write %s: %w", path, err)
	}
	return newSigner(priv)
}

func newSigner(priv ed25519.PrivateKey) (*Signer, error) {
	der, err := x509.MarshalPKIXPublicKey(priv.Public())
	if err != nil {
		return nil, fmt.Errorf("encode public key: %w", err)
	}
	return &Signer{key: priv, publicKey: base64.StdEncoding.EncodeToString(der)}, nil
}

// PublicKey returns the public key as written to the "key" of each line.
func (s *Signer) PublicKey() string { return s.publicKey }

// Sign returns lines where every line that is unsigned, or whose text no
// longer matches its hash, is hashed and signed as an edit by user at time
// now. Other lines keep their signature. lines is not modified.
func (s *Signer) Sign(doc []uint16, lines []lineid.Line, user string, now int64) []lineid.Line {
	texts := lineTexts(doc)
	if len(texts) != len(lines) {
		return lines // out of step with the text: nothing sensible to sign
	}
	out := slices.Clone(lines)
	for i := range out {
		l := &out[i]
		hash := hashOf(texts[i])
		if l.Signature != "" && l.Hash == hash {
			continue
		}
		l.Hash, l.Updated, l.User, l.Key = hash, now, user, s.publicKey
		l.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(s.key, message(*l)))
	}
	return out
}

// message is what gets signed. The prefix keeps the signature from being valid
// for any other purpose.
func message(l lineid.Line) []byte {
	return fmt.Appendf(nil, "aspen-line-v1\n%s\n%s\n%d\n%s\n%s",
		l.ID, l.Hash, l.Updated, l.User, l.Key)
}

func hashOf(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

// lineTexts splits doc into its lines. There is always at least one.
func lineTexts(doc []uint16) []string {
	var lines []string
	start := 0
	for i, u := range doc {
		if u == '\n' {
			lines = append(lines, string(utf16.Decode(doc[start:i])))
			start = i + 1
		}
	}
	return append(lines, string(utf16.Decode(doc[start:])))
}
