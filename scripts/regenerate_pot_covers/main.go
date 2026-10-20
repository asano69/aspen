package main

// regenerate_pot_covers
// ---
// go run ./scripts/regenerate_pot_covers --dir=pb_data
// go run ./scripts/regenerate_pot_covers --dir=pb_data --dry-run
// ---
//
// One-off bulk regeneration of generated pot covers. Run it after changing
// the avatar parameters (palette, size, style) in internal/serve/pot_cover.go.
//
// Only covers that look generated are replaced: PocketBase stores the
// generated "cover.svg" as "cover_<10 random chars>.svg". Any other file name
// (an uploaded image) and pots without a cover are left untouched. The old
// file is deleted by PocketBase when the new one replaces it.
//
// The serve hooks are not registered in this process, so saving a pot here
// does not trigger a second regeneration.
//
// Safe to re-run: a regenerated cover matches the pattern again, so a second
// run simply regenerates it once more.
//
// IMPORTANT: stop the cardpod server before running this, so nothing else is
// writing to the same data directory at the same time.

import (
	"flag"
	"fmt"
	"log"
	"os"
	"regexp"

	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpod/internal/serve"
)

// generatedCoverRe matches the file name of a generated cover as stored by
// PocketBase (see serve.NewCoverFile).
var generatedCoverRe = regexp.MustCompile(`^cover_[a-z0-9]{10}\.svg$`)

func main() {
	dir := flag.String("dir", envOr("CARDPOD_DATA_DIR", "pb_data"), "PocketBase data directory")
	dryRun := flag.Bool("dry-run", false, "print what would change without writing anything")
	flag.Parse()

	app := core.NewBaseApp(core.BaseAppConfig{DataDir: *dir})
	if err := app.Bootstrap(); err != nil {
		log.Fatalf("bootstrap app: %v", err)
	}
	defer func() { _ = app.ResetBootstrapState() }()

	pots, err := app.FindRecordsByFilter("pots", "", "", 0, 0, nil)
	if err != nil {
		log.Fatalf("list pots: %v", err)
	}
	fmt.Printf("%d pot(s) to check\n", len(pots))

	updated := 0
	for _, pot := range pots {
		if !generatedCoverRe.MatchString(pot.GetString("cover")) {
			continue
		}
		if *dryRun {
			fmt.Printf("  [dry-run] %s (%q)\n", pot.Id, pot.GetString("title"))
			continue
		}

		file, err := serve.NewCoverFile(pot.GetString("title"))
		if err != nil {
			log.Fatalf("make cover for pot %s: %v", pot.Id, err)
		}
		pot.Set("cover", file)
		if err := app.Save(pot); err != nil {
			log.Fatalf("save pot %s: %v", pot.Id, err)
		}
		updated++
		fmt.Printf("  [ok] %s (%q)\n", pot.Id, pot.GetString("title"))
	}

	fmt.Printf("done: %d updated\n", updated)
}

func envOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
