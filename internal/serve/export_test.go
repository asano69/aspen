package serve

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"

	"github.com/asano69/cardpod/internal/lineid"
)

// newExportTestApp extends newImportTestApp with what Export reads beyond it:
// the soft-delete field of pods and the attachments collection.
func newExportTestApp(t *testing.T) core.App {
	t.Helper()
	app := newImportTestApp(t)

	pods, err := app.FindCollectionByNameOrId("pods")
	if err != nil {
		t.Fatalf("find pods collection: %v", err)
	}
	pods.Fields.Add(&core.DateField{Name: "deleted"})
	if err := app.Save(pods); err != nil {
		t.Fatalf("extend pods collection: %v", err)
	}

	attachments := core.NewBaseCollection("attachments")
	attachments.Fields.Add(&core.FileField{Name: "image", MaxSelect: 1})
	if err := app.Save(attachments); err != nil {
		t.Fatalf("create attachments collection: %v", err)
	}
	return app
}

// createAttachment stores a small file and returns the note notation of it.
func createAttachment(t *testing.T, app core.App, content string) (record *core.Record, src string) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("attachments")
	if err != nil {
		t.Fatalf("find attachments collection: %v", err)
	}
	file, err := filesystem.NewFileFromBytes([]byte(content), "a.png")
	if err != nil {
		t.Fatalf("make file: %v", err)
	}
	record = core.NewRecord(collection)
	record.Set("image", file)
	if err := app.Save(record); err != nil {
		t.Fatalf("save attachment: %v", err)
	}
	return record, "@/" + record.Id + "/" + record.GetString("image")
}

// importPages imports pages given as title -> lines into pod.
func importPages(t *testing.T, app core.App, pod string, pages ...map[string]any) {
	t.Helper()
	data, err := json.Marshal(map[string]any{"pages": pages})
	if err != nil {
		t.Fatalf("encode pages: %v", err)
	}
	runImport(t, app, pod, string(data))
}

// runExport exports pod into a fresh directory.
func runExport(t *testing.T, app core.App, pod string) (string, ExportResult) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "out")
	result, err := Export(app, pod, dir)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	return dir, result
}

// readFiles returns the files under dir by their "/" path (folders are left
// out).
func readFiles(t *testing.T, dir string) map[string]string {
	t.Helper()
	got := map[string]string{}
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		got[filepath.ToSlash(rel)] = string(data)
		return nil
	})
	if err != nil {
		t.Fatalf("read %s: %v", dir, err)
	}
	return got
}

func readManifest(t *testing.T, files map[string]string) manifest {
	t.Helper()
	var m manifest
	if err := json.Unmarshal([]byte(files[manifestName]), &m); err != nil {
		t.Fatalf("decode manifest %q: %v", files[manifestName], err)
	}
	return m
}

func TestExport_WritesOnePodInTheDirectoryLayout(t *testing.T) {
	app := newExportTestApp(t)
	src := createPod(t, app, "src")
	createPod(t, app, "other")
	runImport(t, app, "src", `{"pages":[
		{"title":"alpha","lines":["alpha","body"]},
		{"title":"gone","lines":["gone"]}
	]}`)
	runImport(t, app, "other", `{"pages":[{"title":"beta","lines":["beta"]}]}`)
	softDelete(t, app, cardInPod(t, app, src.Id, "gone"))

	dir, result := runExport(t, app, "src")
	if result != (ExportResult{Cards: 1}) {
		t.Errorf("result = %+v, want 1 card and no assets", result)
	}

	files := readFiles(t, dir)
	if len(files) != 3 {
		t.Errorf("files = %v, want manifest, one text and one lines file", files)
	}
	if files["cards/alpha.csn"] != "alpha\nbody" {
		t.Errorf("text = %q, want %q", files["cards/alpha.csn"], "alpha\nbody")
	}
	var lines []lineid.Line
	if err := json.Unmarshal([]byte(files["cards/alpha.json"]), &lines); err != nil || len(lines) != 2 {
		t.Errorf("lines = %q, want a JSON array of 2 lines (err %v)", files["cards/alpha.json"], err)
	}

	m := readManifest(t, files)
	want := manifestCard{Text: "cards/alpha.csn", Lines: "cards/alpha.json"}
	if len(m.Cards) != 1 || m.Cards[0] != want || len(m.Assets) != 0 {
		t.Errorf("manifest = %+v, want the card %+v and no assets", m, want)
	}
}

func TestExport_EmptyPodStillHasItsFolders(t *testing.T) {
	app := newExportTestApp(t)
	createPod(t, app, "src")

	dir, _ := runExport(t, app, "src")

	for _, sub := range []string{"cards", "assets"} {
		if info, err := os.Stat(filepath.Join(dir, sub)); err != nil || !info.IsDir() {
			t.Errorf("%s is not a folder (err %v)", sub, err)
		}
	}
}

func TestExport_CardsFollowTitleLcOrderInTheManifest(t *testing.T) {
	app := newExportTestApp(t)
	createPod(t, app, "src")
	importPages(t, app, "src",
		map[string]any{"title": "Banana", "lines": []string{"Banana"}},
		map[string]any{"title": "apple", "lines": []string{"apple"}},
		map[string]any{"title": "Cherry", "lines": []string{"Cherry"}},
	)

	dir, _ := runExport(t, app, "src")

	var got []string
	for _, c := range readManifest(t, readFiles(t, dir)).Cards {
		got = append(got, c.Text)
	}
	want := []string{"cards/apple.csn", "cards/Banana.csn", "cards/Cherry.csn"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("manifest order = %v, want %v", got, want)
	}
}

func TestExport_TitlesThatSanitizeAlikeGetNumberedNames(t *testing.T) {
	app := newExportTestApp(t)
	createPod(t, app, "src")
	importPages(t, app, "src",
		map[string]any{"title": "a/b", "lines": []string{"a/b"}},
		map[string]any{"title": "a:b", "lines": []string{"a:b"}},
		map[string]any{"title": "a?b", "lines": []string{"a?b"}},
	)

	dir, _ := runExport(t, app, "src")

	files := readFiles(t, dir)
	m := readManifest(t, files)
	seen := map[string]bool{}
	for _, c := range m.Cards {
		if seen[strings.ToLower(c.Text)] {
			t.Errorf("name %q is used twice", c.Text)
		}
		seen[strings.ToLower(c.Text)] = true
		if _, ok := files[c.Text]; !ok {
			t.Errorf("manifest lists %q, which was not written", c.Text)
		}
	}
	if len(m.Cards) != 3 {
		t.Errorf("got %d cards in the manifest, want 3", len(m.Cards))
	}
}

func TestUniqueStem(t *testing.T) {
	used := map[string]bool{}
	got := []string{
		uniqueStem("a", used),
		uniqueStem("a", used),
		uniqueStem("A", used), // differs only in case: still a collision
		uniqueStem("b", used),
	}
	want := []string{"a", "a(2)", "A(3)", "b"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("stems = %v, want %v", got, want)
	}
}

func TestUniqueStem_LongStemKeepsItsSuffixWithinTheLimit(t *testing.T) {
	used := map[string]bool{}
	stem := exportStem(strings.Repeat("あ", 100)) // 300 bytes, cut by exportStem

	for i := 1; i <= 105; i++ { // covers 1-, 2- and 3-digit suffixes
		name := uniqueStem(stem, used)
		if len(name) > maxStemBytes || !utf8.ValidString(name) {
			t.Fatalf("name %d: %d bytes, valid UTF-8 %v; want at most %d and valid",
				i, len(name), utf8.ValidString(name), maxStemBytes)
		}
	}
	if len(used) != 105 {
		t.Errorf("got %d distinct names, want 105", len(used))
	}
}

func TestExport_LongTitleKeepsTheFileNameWithinTheLimit(t *testing.T) {
	app := newExportTestApp(t)
	createPod(t, app, "src")
	title := strings.Repeat("あ", 240) // 720 bytes
	importPages(t, app, "src", map[string]any{"title": title, "lines": []string{title}})

	dir, _ := runExport(t, app, "src")

	m := readManifest(t, readFiles(t, dir))
	if len(m.Cards) != 1 {
		t.Fatalf("got %d cards, want 1", len(m.Cards))
	}
	for _, rel := range []string{m.Cards[0].Text, m.Cards[0].Lines} {
		base := filepath.Base(rel)
		if len(base) > 255 || !utf8.ValidString(base) {
			t.Errorf("name %q: %d bytes, valid UTF-8 %v; want at most 255 and valid",
				base, len(base), utf8.ValidString(base))
		}
	}
}

func TestExportStem(t *testing.T) {
	if got := exportStem(""); got != fallbackStem {
		t.Errorf(`exportStem("") = %q, want %q`, got, fallbackStem)
	}
	if got := exportStem(`a/b:c*d?e`); strings.ContainsAny(got, `/\:*?"<>|`) {
		t.Errorf("exportStem kept an unsafe character: %q", got)
	}
	long := exportStem(strings.Repeat("あ", 100))
	if len(long) > maxStemBytes || !utf8.ValidString(long) {
		t.Errorf("long stem: %d bytes, valid UTF-8 %v", len(long), utf8.ValidString(long))
	}
}

func TestExport_WritesTheAttachmentsOfTheCardsOnce(t *testing.T) {
	app := newExportTestApp(t)
	createPod(t, app, "src")
	attachment, src := createAttachment(t, app, "png-bytes")
	missing := "@/zzzzzzzzzzzzzzz/gone.png"
	importPages(t, app, "src",
		map[string]any{"title": "one", "lines": []string{"one", "[" + src + "]", "[" + missing + "]"}},
		map[string]any{"title": "two", "lines": []string{"two", "[[" + src + "]]"}},
	)

	dir, result := runExport(t, app, "src")
	if result.Cards != 2 || result.Assets != 1 {
		t.Errorf("result = %+v, want 2 cards and 1 asset", result)
	}

	name := "assets/" + attachment.Id + "/" + attachment.GetString("image")
	files := readFiles(t, dir)
	if files[name] != "png-bytes" {
		t.Errorf("%s = %q, want %q", name, files[name], "png-bytes")
	}
	m := readManifest(t, files)
	if len(m.Assets) != 1 || m.Assets[0] != name {
		t.Errorf("manifest assets = %v, want [%s]", m.Assets, name)
	}
	for entry := range files {
		if strings.HasPrefix(entry, "assets/") && entry != name {
			t.Errorf("unexpected asset %q", entry)
		}
	}
}

func TestExport_UnknownPod(t *testing.T) {
	app := newExportTestApp(t)

	_, err := Export(app, "missing", filepath.Join(t.TempDir(), "out"))
	if err == nil || !strings.Contains(err.Error(), `pod "missing" not found`) {
		t.Errorf("err = %v, want a pod-not-found error", err)
	}
}
