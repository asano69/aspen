package main

// regenerate_pod_covers
// ---
// go run ./scripts/regenerate_pod_covers --dir=pb_data
// go run ./scripts/regenerate_pod_covers --dir=pb_data --dry-run
// ---
//
// One-off bulk regeneration of generated pod covers. Run it after changing
// the avatar parameters (palette, size, style) in internal/serve/pod_cover.go.
//
// Only covers that look generated are replaced: PocketBase stores the
// generated "cover.svg" as "cover_<10 random chars>.svg". Any other file name
// (an uploaded image) and pods without a cover are left untouched. The old
// file is deleted by PocketBase when the new one replaces it.
//
// The serve hooks are not registered in this process, so saving a pod here
// does not trigger a second regeneration.
//
// Safe to re-run: a regenerated cover matches the pattern again, so a second
// run simply regenerates it once more.
//
// IMPORTANT: stop the aspen server before running this, so nothing else is
// writing to the same data directory at the same time.

import (
	"flag"
	"fmt"
	"log"
	"os"
	"regexp"

	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/aspen/internal/serve"
)

// generatedCoverRe matches the file name of a generated cover as stored by
// PocketBase (see serve.NewCoverFile).
var generatedCoverRe = regexp.MustCompile(`^cover_[a-z0-9]{10}\.svg$`)

func main() {
	dir := flag.String("dir", envOr("ASPEN_DATA_DIR", "pb_data"), "PocketBase data directory")
	dryRun := flag.Bool("dry-run", false, "print what would change without writing anything")
	flag.Parse()

	app := core.NewBaseApp(core.BaseAppConfig{DataDir: *dir})
	if err := app.Bootstrap(); err != nil {
		log.Fatalf("bootstrap app: %v", err)
	}
	defer func() { _ = app.ResetBootstrapState() }()

	pods, err := app.FindRecordsByFilter("pods", "", "", 0, 0, nil)
	if err != nil {
		log.Fatalf("list pods: %v", err)
	}
	fmt.Printf("%d pod(s) to check\n", len(pods))

	updated := 0
	for _, pod := range pods {
		if !generatedCoverRe.MatchString(pod.GetString("cover")) {
			continue
		}
		if *dryRun {
			fmt.Printf("  [dry-run] %s (%q)\n", pod.Id, pod.GetString("title"))
			continue
		}

		file, err := serve.NewCoverFile(pod.GetString("title"))
		if err != nil {
			log.Fatalf("make cover for pod %s: %v", pod.Id, err)
		}
		pod.Set("cover", file)
		if err := app.Save(pod); err != nil {
			log.Fatalf("save pod %s: %v", pod.Id, err)
		}
		updated++
		fmt.Printf("  [ok] %s (%q)\n", pod.Id, pod.GetString("title"))
	}

	fmt.Printf("done: %d updated\n", updated)
}

func envOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
