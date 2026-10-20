// scripts/migrate_pm_to_codemirror/main.go
package main

// migrate_pm_to_codemirror
// ---
// go run ./scripts/migrate_pm_to_codemirror --dir=pb_data
// go run ./scripts/migrate_pm_to_codemirror --dir=pb_data --dry-run
// ---
//
// One-time, throwaway migration: converts every card's existing
// ProseMirror-shaped Yjs document (a "prosemirror" YXmlFragment) into
// a CodeMirror-shaped Yjs document (a single YText root holding plain
// text, one line per paragraph/heading/codeBlock). This is a lossy,
// best-effort conversion -- formatting marks (bold/italic/links),
// tables, and images are all dropped on purpose. The only thing this
// script guarantees is that no line of actual text is lost.
//
// IMPORTANT:
//   - Stop the cardpod server before running this.
//   - Back up pb_data/ first -- this OVERWRITES every card's
//     card_ydocs records.
//   - This assumes the new CodeMirror editor reads its content from a
//     YText root named textFieldName below. Adjust that constant to
//     match whatever name the real y-codemirror.next integration ends
//     up using.
//   - This script only converts stored data. It does not touch the
//     server's own persistence code (internal/serve/ydoc.go) -- that
//     still needs to be rewritten separately to read a plain YText
//     instead of a "prosemirror" XmlFragment once the CodeMirror
//     editor itself is wired up.
//
// Run this exactly once per environment: after it runs, a card's room
// no longer has a "prosemirror" XmlFragment to read from, so a second
// run against already-migrated data would just find nothing and skip
// every card.
//
// Use --dry-run first to review the extracted text before writing
// anything.

import (
	"encoding/base64"
	"encoding/xml"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/reearth/ygo/crdt"
)

// textFieldName is the YText root name the new CodeMirror-based
// editor is assumed to read from. Change this to match whatever name
// the real editor integration ends up using.
const textFieldName = "content"

// textblockTags mirrors internal/serve/lines.go's own list: only
// these ProseMirror node types carry their own line of text. Copied
// here rather than imported, so this throwaway script has no
// dependency on internal/serve's own package-level state (e.g. its
// yjsServer global).
var textblockTags = map[string]bool{
	"paragraph": true,
	"heading":   true,
	"codeBlock": true,
}

func main() {
	dir := flag.String("dir", envOr("CARDPOD_DATA_DIR", "pb_data"), "PocketBase data directory")
	dryRun := flag.Bool("dry-run", false, "print the extracted text per card without writing anything")
	flag.Parse()

	app := core.NewBaseApp(core.BaseAppConfig{DataDir: *dir})
	if err := app.Bootstrap(); err != nil {
		log.Fatalf("bootstrap app: %v", err)
	}
	defer func() { _ = app.ResetBootstrapState() }()

	cards, err := app.FindRecordsByFilter("cards", "", "", 0, 0, nil)
	if err != nil {
		log.Fatalf("list cards: %v", err)
	}
	fmt.Printf("%d card(s) to migrate\n", len(cards))

	collection, err := app.FindCollectionByNameOrId("card_ydocs")
	if err != nil {
		log.Fatalf("find card_ydocs collection: %v", err)
	}

	migrated := 0
	for _, card := range cards {
		text, err := extractCardText(app, card.Id)
		if err != nil {
			log.Printf("  [skip] %s: %v", card.Id, err)
			continue
		}

		if *dryRun {
			fmt.Printf("--- %s ---\n%s\n\n", card.Id, text)
			continue
		}

		payload, err := encodeCodeMirrorDoc(text)
		if err != nil {
			log.Printf("  [skip] %s: encode failed: %v", card.Id, err)
			continue
		}

		if err := replaceCardYdocs(app, collection, card.Id, payload); err != nil {
			log.Printf("  [skip] %s: replace failed: %v", card.Id, err)
			continue
		}

		migrated++
		fmt.Printf("  [ok] %s (%d chars)\n", card.Id, len(text))
	}

	fmt.Printf("done: %d/%d migrated\n", migrated, len(cards))
}

// extractCardText replays every stored update for card's room, merging
// them into a single live doc (same approach as ydoc.go's own
// LoadDoc/mergeUpdates), then walks its "prosemirror" XmlFragment and
// returns the plain text of every textblock line, joined by "\n". An
// empty update log (a card that was never opened) returns "".
func extractCardText(app core.App, cardID string) (string, error) {
	records, err := app.FindRecordsByFilter(
		"card_ydocs", "card = {:card}", "created", 0, 0,
		dbx.Params{"card": cardID},
	)
	if err != nil {
		return "", fmt.Errorf("list card_ydocs: %w", err)
	}
	if len(records) == 0 {
		return "", nil
	}

	doc := crdt.New()
	for _, record := range records {
		encoded := record.GetString("payload")
		if encoded == "" {
			continue
		}
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return "", fmt.Errorf("decode payload %s: %w", record.Id, err)
		}
		if err := doc.ApplyUpdate(data); err != nil {
			return "", fmt.Errorf("apply update %s: %w", record.Id, err)
		}
	}

	xmlStr := doc.GetXmlFragment("prosemirror").ToXML()
	return extractPlainText(xmlStr)
}

// extractPlainText walks xmlStr's element tree (the same ToXML()
// output internal/serve/lines.go parses) and returns the text content
// of every textblock element (paragraph/heading/codeBlock), one per
// line, joined by "\n". Non-textblock elements (blockquote, list,
// table, image, ...) contribute no line of their own -- an <image>
// element in particular has no char data of its own, so it's dropped
// automatically without any special-casing.
func extractPlainText(xmlStr string) (string, error) {
	decoder := xml.NewDecoder(strings.NewReader(xmlStr))

	var lines []string
	var current strings.Builder
	var depth int // 0 = not currently inside a textblock

	for {
		tok, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("parse card xml: %w", err)
		}

		switch t := tok.(type) {
		case xml.StartElement:
			if depth == 0 && textblockTags[t.Name.Local] {
				depth = 1
				current.Reset()
			} else if depth > 0 {
				depth++
			}
		case xml.EndElement:
			if depth == 0 {
				continue
			}
			depth--
			if depth == 0 {
				line := strings.TrimSpace(current.String())
				if line != "" {
					lines = append(lines, line)
				}
			}
		case xml.CharData:
			if depth > 0 {
				current.Write(t)
			}
		}
	}

	return strings.Join(lines, "\n"), nil
}

// encodeCodeMirrorDoc builds a brand-new Yjs document containing a
// single YText root (see textFieldName) holding text, and returns its
// full state as a base64-encoded V1 update -- ready to drop straight
// into card_ydocs.payload, using the same encoding ydoc.go already
// produces for its own increments.
func encodeCodeMirrorDoc(text string) (string, error) {
	doc := crdt.New()
	ytext := doc.GetText(textFieldName)
	doc.Transact(func(txn *crdt.Transaction) {
		if text != "" {
			ytext.Insert(txn, 0, text, nil)
		}
	})
	update := crdt.EncodeStateAsUpdateV1(doc, nil)
	return base64.StdEncoding.EncodeToString(update), nil
}

// replaceCardYdocs deletes every existing card_ydocs record for
// cardID and inserts a single new one holding payload -- the same
// "one record per room, encoded state" shape ydoc.go's own
// compactIfNeeded already produces, so the running server's LoadDoc
// picks this up with no other code changes needed.
func replaceCardYdocs(app core.App, collection *core.Collection, cardID, payload string) error {
	existing, err := app.FindRecordsByFilter(
		"card_ydocs", "card = {:card}", "", 0, 0,
		dbx.Params{"card": cardID},
	)
	if err != nil {
		return fmt.Errorf("list existing card_ydocs: %w", err)
	}

	record := core.NewRecord(collection)
	record.Set("card", cardID)
	record.Set("payload", payload)
	if err := app.Save(record); err != nil {
		return fmt.Errorf("save new card_ydocs: %w", err)
	}

	for _, old := range existing {
		if err := app.Delete(old); err != nil {
			return fmt.Errorf("delete old card_ydocs %s: %w", old.Id, err)
		}
	}
	return nil
}

func envOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
