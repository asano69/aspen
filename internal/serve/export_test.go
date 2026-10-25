package serve

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"path"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"

	"github.com/asano69/cardpod/internal/lineid"
)

// newExportTestApp extends newImportTestApp with what Export reads beyond it:
// the soft-delete field of pots and the attachments collection.
func newExportTestApp(t *testing.T) core.App {
	t.Helper()
	app := newImportTestApp(t)

	pots, err := app.FindCollectionByNameOrId("pots")
	if err != nil {
		t.Fatalf("find pots collection: %v", err)
	}
	pots.Fields.Add(&core.DateField{Name: "deleted"})
	if err := app.Save(pots); err != nil {
		t.Fatalf("extend pots collection: %v", err)
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

// readArchive returns the entries of a zip archive by name.
func readArchive(t *testing.T, buf *bytes.Buffer) map[string]string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}
	got := map[string]string{}
	for _, f := range zr.File {
		r, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", f.Name, err)
		}
		data, err := io.ReadAll(r)
		r.Close()
		if err != nil {
			t.Fatalf("read %s: %v", f.Name, err)
		}
		got[f.Name] = string(data)
	}
	return got
}

// importPages imports pages given as title -> lines into pot.
func importPages(t *testing.T, app core.App, pot string, pages ...map[string]any) {
	t.Helper()
	data, err := json.Marshal(map[string]any{"pages": pages})
	if err != nil {
		t.Fatalf("encode pages: %v", err)
	}
	runImport(t, app, pot, string(data))
}

func TestExport_WritesOnePotInTheArchiveLayout(t *testing.T) {
	app := newExportTestApp(t)
	src := createPot(t, app, "src")
	createPot(t, app, "other")
	runImport(t, app, "src", `{"pages":[
		{"title":"alpha","lines":["alpha","body"]},
		{"title":"gone","lines":["gone"]}
	]}`)
	runImport(t, app, "other", `{"pages":[{"title":"beta","lines":["beta"]}]}`)
	softDelete(t, app, cardInPot(t, app, src.Id, "gone"))
	alpha := cardInPot(t, app, src.Id, "alpha")

	var buf bytes.Buffer
	result, err := Export(app, "src", &buf)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	if result != (ExportResult{Cards: 1}) {
		t.Errorf("result = %+v, want 1 card and no assets", result)
	}

	got := readArchive(t, &buf)

	// One signed-lines entry per line of the text (title and body).
	sigName := "src/cards/alpha." + alpha.Id + ".sig.json"
	var lines []lineid.Line
	if err := json.Unmarshal([]byte(got[sigName]), &lines); err != nil || len(lines) != 2 {
		t.Errorf("%s = %q, want a JSON array of 2 lines (err %v)", sigName, got[sigName], err)
	}
	delete(got, sigName)

	want := map[string]string{
		"src/":              "",
		"src/assets/":       "",
		"src/cards/":        "",
		"src/manifest.json": "",
		"src/cards/alpha." + alpha.Id + ".csn": "alpha\nbody",
	}
	if !maps.Equal(got, want) {
		t.Errorf("archive = %q, want %q", got, want)
	}
}

func TestExport_TitlesThatSanitizeAlikeKeepDistinctNames(t *testing.T) {
	app := newExportTestApp(t)
	createPot(t, app, "src")
	importPages(t, app, "src",
		map[string]any{"title": "a/b", "lines": []string{"a/b"}},
		map[string]any{"title": "a:b", "lines": []string{"a:b"}},
		map[string]any{"title": "a?b", "lines": []string{"a?b"}},
	)

	var buf bytes.Buffer
	if _, err := Export(app, "src", &buf); err != nil {
		t.Fatalf("Export: %v", err)
	}

	texts := 0
	for name := range readArchive(t, &buf) {
		if strings.HasSuffix(name, exportTextExt) {
			texts++
			if base := path.Base(name); strings.ContainsAny(base, `/\:*?"<>|`) {
				t.Errorf("unsafe file name %q", base)
			}
		}
	}
	// A duplicate name would have replaced an entry in the map above.
	if texts != 3 {
		t.Errorf("got %d card files, want 3", texts)
	}
}

func TestExport_LongTitleKeepsTheNameWithinTheLimit(t *testing.T) {
	app := newExportTestApp(t)
	pot := createPot(t, app, "src")
	title := strings.Repeat("あ", 240) // 720 bytes
	importPages(t, app, "src", map[string]any{"title": title, "lines": []string{title}})
	card := cardInPot(t, app, pot.Id, strings.ToLower(title))

	var buf bytes.Buffer
	if _, err := Export(app, "src", &buf); err != nil {
		t.Fatalf("Export: %v", err)
	}

	found := false
	for name := range readArchive(t, &buf) {
		if !strings.HasPrefix(name, "src/cards/") || name == "src/cards/" {
			continue
		}
		found = true
		base := path.Base(name)
		if len(base) > 255 || !utf8.ValidString(base) {
			t.Errorf("name %q: %d bytes, valid UTF-8 %v; want at most 255 and valid", base, len(base), utf8.ValidString(base))
		}
		if !strings.Contains(base, "."+card.Id+".") {
			t.Errorf("name %q lost the card id", base)
		}
	}
	if !found {
		t.Error("no card file was written")
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
	createPot(t, app, "src")
	attachment, src := createAttachment(t, app, "png-bytes")
	missing := "@/zzzzzzzzzzzzzzz/gone.png"
	importPages(t, app, "src",
		map[string]any{"title": "one", "lines": []string{"one", "[" + src + "]", "[" + missing + "]"}},
		map[string]any{"title": "two", "lines": []string{"two", "[[" + src + "]]"}},
	)

	var buf bytes.Buffer
	result, err := Export(app, "src", &buf)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	if result.Cards != 2 || result.Assets != 1 {
		t.Errorf("result = %+v, want 2 cards and 1 asset", result)
	}

	name := fmt.Sprintf("src/assets/%s/%s", attachment.Id, attachment.GetString("image"))
	got := readArchive(t, &buf)
	if got[name] != "png-bytes" {
		t.Errorf("%s = %q, want %q", name, got[name], "png-bytes")
	}
	for entry := range got {
		if strings.HasPrefix(entry, "src/assets/") && !strings.HasSuffix(entry, "/") && entry != name {
			t.Errorf("unexpected asset %q", entry)
		}
	}
}

func TestExport_UnknownPot(t *testing.T) {
	app := newExportTestApp(t)

	_, err := Export(app, "missing", &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), `pot "missing" not found`) {
		t.Errorf("err = %v, want a pot-not-found error", err)
	}
}
