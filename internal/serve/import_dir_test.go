package serve

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// writeExport writes a minimal export folder with one card and returns it.
func writeExport(t *testing.T, name, title string) string {
	t.Helper()
	dir := t.TempDir()
	m := manifest{
		PodName:  name,
		PodTitle: title,
		Cards:    []manifestCard{{Title: "alpha", Text: "cards/alpha.csn", Lines: "cards/alpha.json"}},
		Assets:   []string{},
	}
	data, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("encode manifest: %v", err)
	}
	for rel, content := range map[string]string{
		manifestName:       string(data),
		"cards/alpha.csn":  "alpha\nbody",
		"cards/alpha.json": "[]",
	} {
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
