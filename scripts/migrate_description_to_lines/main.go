// scripts/migrate_description_to_lines/main.go
package main

// migrate_description_to_lines
// ---
// go run ./scripts/migrate_description_to_lines --dir=pb_data
// go run ./scripts/migrate_description_to_lines --dir=pb_data --dry-run
// ---
//
// One-off migration: rewrites each "cards" record's "description" JSON field
// from the old shape (a single JSON string holding the preview text, e.g.
// "line1\nline2") to the new shape (a JSON array with one entry per line,
// e.g. ["line1","line2"]), matching descriptionLines in
// internal/serve/ydoc.go.
//
// Safe to re-run: a value that already is a JSON array is left untouched,
// so a second run is a no-op.
//
// Saving bumps each record's "updated", so clients pick the change up
// through the normal Dexie pull.
//
// IMPORTANT:
//   - Stop the cardpod server before running this, so nothing else is
//     writing to the same data directory at the same time.
//   - Back up pb_data/ first.
//   - Run it together with the backend change that starts writing the new
//     shape, or updatePreview will write the old shape again.
//
// Use --dry-run first to see what would change without writing anything.

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func main() {
	dir := flag.String("dir", envOr("CARDPOD_DATA_DIR", "pb_data"), "PocketBase data directory")
	dryRun := flag.Bool("dry-run", false, "print what would change without writing anything")
	flag.Parse()

	app := core.NewBaseApp(core.BaseAppConfig{DataDir: *dir})
	if err := app.Bootstrap(); err != nil {
		log.Fatalf("bootstrap app: %v", err)
	}
	defer func() { _ = app.ResetBootstrapState() }()

	records, err := app.FindRecordsByFilter("cards", "", "", 0, 0, nil)
	if err != nil {
		log.Fatalf("list cards: %v", err)
	}
	fmt.Printf("%d card(s) to check\n", len(records))

	updated := 0
	for _, record := range records {
		lines, changed, err := convertDescription(record.GetString("description"))
		if err != nil {
			log.Fatalf("card %s: %v", record.Id, err)
		}
		if !changed {
			continue
		}

		encoded, err := json.Marshal(lines)
		if err != nil {
			log.Fatalf("card %s: encode description: %v", record.Id, err)
		}
		if *dryRun {
			fmt.Printf("  [dry-run] %s: %s\n", record.Id, encoded)
			continue
		}

		record.Set("description", types.JSONRaw(encoded))
		if err := app.Save(record); err != nil {
			log.Fatalf("save card %s: %v", record.Id, err)
		}
		updated++
		fmt.Printf("  [ok] %s: %d line(s)\n", record.Id, len(lines))
	}

	fmt.Printf("done: %d/%d updated\n", updated, len(records))
}

// convertDescription turns a stored description (GetString on a JSON field
// returns its raw JSON text) into the new list of lines. changed is false
// when raw already is a JSON array.
func convertDescription(raw string) (lines []string, changed bool, err error) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "[") {
		return nil, false, nil
	}
	// A card that never had a preview: empty or JSON null.
	if raw == "" || raw == "null" {
		return []string{}, true, nil
	}

	var text string
	if err := json.Unmarshal([]byte(raw), &text); err != nil {
		return nil, false, fmt.Errorf("description is neither a JSON array nor a JSON string (%q): %w", raw, err)
	}
	return splitLines(text), true, nil
}

// splitLines mirrors descriptionLines in internal/serve/ydoc.go: an empty
// preview is an empty list (never nil, which would encode as JSON null).
func splitLines(text string) []string {
	if text == "" {
		return []string{}
	}
	return strings.Split(text, "\n")
}

func envOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
