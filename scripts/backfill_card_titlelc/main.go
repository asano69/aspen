package main

// backfill_card_titlelc
// ---
// go run ./scripts/backfill_card_titlelc --dir=pb_data
// ---
//
// One-off backfill: computes each "cards" record's "titleLc" field from
// its existing "title" via internal/slug.ToLowerKey -- the exact same
// function the server uses at save time (see internal/serve/cards.go
// and title_watch.go) -- so the backfilled values are guaranteed
// consistent with what the server would have written itself.
//
// Unlike backfill_card_slugs, there is no uniqueness constraint to
// worry about here: titleLc only backs case-insensitive search, so
// two cards are free to share the same value. This script simply
// updates every record whose stored titleLc doesn't already match.
//
// Safe to re-run: a record whose titleLc already matches
// slug.ToLowerKey(title) is left untouched, so a second run is a
// no-op.
//
// IMPORTANT: stop the cardpod server before running this, so nothing
// else is writing to the same data directory at the same time.

import (
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpod/internal/slug"
)

func main() {
	dir := flag.String("dir", envOr("CARDPOD_DATA_DIR", "pb_data"), "PocketBase data directory")
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
		title := record.GetString("title")
		computed := slug.ToLowerKey(title)

		if record.GetString("titleLc") == computed {
			continue // already correct -- no-op write avoided
		}
		record.Set("titleLc", computed)
		if err := app.Save(record); err != nil {
			log.Fatalf("save card %s: %v", record.Id, err)
		}
		updated++
		fmt.Printf("  [ok] %s: titleLc -> %q\n", record.Id, computed)
	}

	fmt.Printf("done: %d/%d updated\n", updated, len(records))
}

func envOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
