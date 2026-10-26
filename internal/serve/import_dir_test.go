package serve

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// testCover is the content of the cover image written by writeExportWithCover.
const testCover = `<svg xmlns="http://www.w3.org/2000/svg"><title>imported</title></svg>`

// writeExport writes a minimal export folder with one card and returns it.
func writeExport(t *testing.T, name, title string) string {
	t.Helper()
	return writeExportWithCover(t, name, title, "")
}

// writeExportWithCover is writeExport with a cover image at the given path
// ("" for none).
func writeExportWithCover(t *testing.T, name, title, cover string) string {
	t.Helper()
	dir := t.TempDir()
	m := manifest{
		PodName:  name,
		PodTitle: title,
		Cover:    cover,
		Cards:    []manifestCard{{Title: "alpha", Text: "cards/alpha.csn", Lines: "cards/alpha.json"}},
		Assets:   []string{},
	}
	data, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("encode manifest: %v", err)
	}
	files := map[string]string{
		manifestName:       string(data),
		"cards/alpha.csn":  "alpha\nbody",
		"cards/alpha.json": "[]",
	}
	if cover != "" {
		files[cover] = testCover
	}
	for rel, content := range files {
		path := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestPlanImport_ExistingPod(t *testing.T) {
	app := newImportTestApp(t)
	createPod(t, app, "src")

	plan, err := PlanImport(app, writeExport(t, "src", "Source"))
	if err != nil {
		t.Fatalf("PlanImport: %v", err)
	}
	if !plan.PodExists || plan.Cards != 1 {
		t.Errorf("plan = %+v, want an existing pod with 1 card", plan)
	}
}

func TestPlanImport_MissingPodIsPlannedNotCreated(t *testing.T) {
	app := newImportTestApp(t)

	plan, err := PlanImport(app, writeExport(t, "fresh", "Fresh"))
	if err != nil {
		t.Fatalf("PlanImport: %v", err)
	}
	if plan.PodExists {
		t.Error("PodExists = true, want false")
	}
	if n, _ := app.CountRecords("pods"); n != 0 {
		t.Errorf("PlanImport created %d pods, want 0", n)
	}
}

func TestPlanImport_RejectsAnUnusableNewPod(t *testing.T) {
	app := newImportTestApp(t)
	cases := []struct{ name, title, want string }{
		{"", "T", "pod_name is empty"},
		{"fresh", "", "pod_title is empty"},
		{"fresh", "   ", "pod_title is empty"},
		{"bad name!", "T", "not a valid pod name"},
		{"-bad", "T", "not a valid pod name"},
		{"api", "T", "reserved"},
		{strings.Repeat("a", 49), "T", "not a valid pod name"},
		{"fresh", strings.Repeat("あ", 61), "longer than"},
	}
	for _, c := range cases {
		_, err := PlanImport(app, writeExport(t, c.name, c.title))
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("name %q title %q: err = %v, want one containing %q", c.name, c.title, err, c.want)
		}
	}
}

func TestPlanImport_ExistingPodNeedsNoTitle(t *testing.T) {
	app := newImportTestApp(t)
	createPod(t, app, "src")

	if _, err := PlanImport(app, writeExport(t, "src", "")); err != nil {
		t.Errorf("PlanImport: %v, want success (the pod exists)", err)
	}
}

// Regression test: an empty path in the manifest used to fail only after the
// pod was created, with a message that did not say which entry was at fault.
func TestPlanImport_NamesTheManifestEntryAtFault(t *testing.T) {
	app := newImportTestApp(t)
	cases := []struct {
		name   string
		change func(m *manifest)
		want   string
	}{
		{"empty text", func(m *manifest) { m.Cards[0].Text = "" }, `cards[0] ("alpha") "text" is empty`},
		{"outside the folder", func(m *manifest) { m.Cards[0].Text = "../x.csn" }, "not a path inside the export folder"},
		{"missing file", func(m *manifest) { m.Cards[0].Lines = "cards/none.json" }, `cards[0] ("alpha") "lines" (cards/none.json)`},
		{"empty asset", func(m *manifest) { m.Assets = []string{""} }, "files[0] is empty"},
		{"missing cover", func(m *manifest) { m.Cover = "cover/none.svg" }, `"cover" (cover/none.svg)`},
	}
	for _, c := range cases {
		dir := writeExport(t, "fresh", "Fresh")
		path := filepath.Join(dir, manifestName)
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var m manifest
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatal(err)
		}
		c.change(&m)
		if data, err = json.Marshal(m); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0o644); err != nil {
			t.Fatal(err)
		}

		_, err = PlanImport(app, dir)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: err = %v, want one containing %q", c.name, err, c.want)
		}
	}
	if n, _ := app.CountRecords("pods"); n != 0 {
		t.Errorf("got %d pods, want 0: nothing may be created", n)
	}
}

func TestApplyImport_CardWithoutLinesMetadata(t *testing.T) {
	app := newExportTestApp(t)
	dir := writeExport(t, "fresh", "Fresh")
	path := filepath.Join(dir, manifestName)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var m manifest
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	m.Cards[0].Lines = ""
	if data, err = json.Marshal(m); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}

	plan, err := PlanImport(app, dir)
	if err != nil {
		t.Fatalf("PlanImport: %v", err)
	}
	if _, err := ApplyImport(app, plan, nil); err != nil {
		t.Fatalf("ApplyImport: %v", err)
	}

	pod, err := findImportPod(app, "fresh")
	if err != nil {
		t.Fatalf("find pod: %v", err)
	}
	if got := cardText(t, app, cardInPod(t, app, pod.Id, "alpha").Id); got != "alpha\nbody" {
		t.Errorf("card text = %q, want %q", got, "alpha\nbody")
	}
}

func TestPlanImport_NotAnExportFolder(t *testing.T) {
	app := newImportTestApp(t)

	_, err := PlanImport(app, t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "export folder") {
		t.Errorf("err = %v, want a hint that the folder is not an export", err)
	}
}

func podsExtended(t *testing.T, app core.App) {
	t.Helper()
	// newImportTestApp's pods collection has name only; ApplyImport also sets
	// title and position.
	pods, err := app.FindCollectionByNameOrId("pods")
	if err != nil {
		t.Fatal(err)
	}
	if pods.Fields.GetByName("title") == nil {
		pods.Fields.Add(&core.TextField{Name: "title"}, &core.NumberField{Name: "position"})
		if err := app.Save(pods); err != nil {
			t.Fatal(err)
		}
	}
}

func TestApplyImport_CreatesThePodAtTheEnd(t *testing.T) {
	app := newExportTestApp(t)
	podsExtended(t, app)
	first := createPod(t, app, "first")
	first.Set("position", 4)
	if err := app.Save(first); err != nil {
		t.Fatal(err)
	}

	plan, err := PlanImport(app, writeExport(t, "fresh", " Fresh "))
	if err != nil {
		t.Fatalf("PlanImport: %v", err)
	}
	result, err := ApplyImport(app, plan, nil)
	if err != nil {
		t.Fatalf("ApplyImport: %v", err)
	}
	if result != (ImportResult{Created: 1}) {
		t.Errorf("result = %+v, want 1 created", result)
	}

	pod, err := findImportPod(app, "fresh")
	if err != nil {
		t.Fatalf("find new pod: %v", err)
	}
	if pod.GetString("title") != "Fresh" || pod.GetFloat("position") != 5 {
		t.Errorf("pod = title %q position %v, want %q and 5", pod.GetString("title"), pod.GetFloat("position"), "Fresh")
	}
	if got := cardText(t, app, cardInPod(t, app, pod.Id, "alpha").Id); got != "alpha\nbody" {
		t.Errorf("card text = %q", got)
	}
}

func TestApplyImport_OverwritesInAnExistingPod(t *testing.T) {
	app := newExportTestApp(t)
	podsExtended(t, app)
	pod := createPod(t, app, "src")
	runImport(t, app, "src", `{"pages":[{"title":"alpha","lines":["alpha","old"]}]}`)

	plan, err := PlanImport(app, writeExport(t, "src", "Source"))
	if err != nil {
		t.Fatalf("PlanImport: %v", err)
	}
	result, err := ApplyImport(app, plan, nil)
	if err != nil {
		t.Fatalf("ApplyImport: %v", err)
	}
	if result != (ImportResult{Overwritten: 1}) {
		t.Errorf("result = %+v, want 1 overwritten", result)
	}
	if got := cardText(t, app, cardInPod(t, app, pod.Id, "alpha").Id); got != "alpha\nbody" {
		t.Errorf("card text = %q, want the imported body", got)
	}
}

// storedCover returns the content of the stored cover of the pod.
func storedCover(t *testing.T, app core.App, podName string) string {
	t.Helper()
	pod, err := findImportPod(app, podName)
	if err != nil {
		t.Fatalf("find pod: %v", err)
	}
	if pod.GetString("cover") == "" {
		t.Fatal("the pod has no cover")
	}
	fsys, err := app.NewFilesystem()
	if err != nil {
		t.Fatalf("open file storage: %v", err)
	}
	defer fsys.Close()
	reader, err := fsys.GetReader(pod.BaseFilesPath() + "/" + pod.GetString("cover"))
	if err != nil {
		t.Fatalf("open cover: %v", err)
	}
	defer reader.Close()
	data, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read cover: %v", err)
	}
	return string(data)
}

func TestApplyImport_NewPodWithoutCoverGetsAGeneratedOne(t *testing.T) {
	// Regression test: the generating hook is not registered in the import
	// command, so a new pod used to get no cover at all.
	app := newExportTestApp(t)

	plan, err := PlanImport(app, writeExport(t, "fresh", "Fresh"))
	if err != nil {
		t.Fatalf("PlanImport: %v", err)
	}
	if _, err := ApplyImport(app, plan, nil); err != nil {
		t.Fatalf("ApplyImport: %v", err)
	}
	if got := storedCover(t, app, "fresh"); !strings.Contains(got, "<svg") {
		t.Errorf("cover = %q, want a generated SVG", got)
	}
}

func TestApplyImport_ManifestCoverReplacesTheCover(t *testing.T) {
	for _, exists := range []bool{false, true} {
		app := newExportTestApp(t)
		if exists {
			createPod(t, app, "src")
		}

		plan, err := PlanImport(app, writeExportWithCover(t, "src", "Source", "cover/c.svg"))
		if err != nil {
			t.Fatalf("PlanImport: %v", err)
		}
		if _, err := ApplyImport(app, plan, nil); err != nil {
			t.Fatalf("ApplyImport: %v", err)
		}
		if got := storedCover(t, app, "src"); got != testCover {
			t.Errorf("pod exists %v: cover = %q, want the imported one", exists, got)
		}
	}
}

func TestApplyImport_MissingCoverFileCreatesNothing(t *testing.T) {
	app := newExportTestApp(t)
	dir := writeExportWithCover(t, "fresh", "Fresh", "cover/c.svg")
	if err := os.Remove(filepath.Join(dir, "cover", "c.svg")); err != nil {
		t.Fatal(err)
	}

	// PlanImport already checks that every file of the manifest exists, so the
	// missing cover is reported before anything can be created.
	if _, err := PlanImport(app, dir); err == nil || !strings.Contains(err.Error(), `"cover" (cover/c.svg)`) {
		t.Errorf("err = %v, want an error naming the missing cover", err)
	}
	if n, _ := app.CountRecords("pods"); n != 0 {
		t.Errorf("got %d pods, want 0", n)
	}
}

func TestImportCosense_UnknownPodIsAnError(t *testing.T) {
	app := newImportTestApp(t)

	_, err := ImportCosense(app, "missing", strings.NewReader(`{"pages":[]}`), nil)
	if err == nil || !strings.Contains(err.Error(), `pod "missing" not found`) {
		t.Errorf("err = %v, want a pod-not-found error", err)
	}
	if n, _ := app.CountRecords("pods"); n != 0 {
		t.Errorf("ImportCosense created %d pods, want 0", n)
	}
}
