package serve

import (
	"archive/zip"
	"bytes"
	"io"
	"maps"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

func TestExport_WritesEveryCardOfEveryPotAsCsn(t *testing.T) {
	app := newImportTestApp(t)
	// Export lists only live pots, so the test pots need the soft-delete field.
	pots, err := app.FindCollectionByNameOrId("pots")
	if err != nil {
		t.Fatalf("find pots collection: %v", err)
	}
	pots.Fields.Add(&core.DateField{Name: "deleted"})
	if err := app.Save(pots); err != nil {
		t.Fatalf("extend pots collection: %v", err)
	}

	src := createPot(t, app, "src")
	empty := createPot(t, app, "empty")
	runImport(t, app, "src", `{"pages":[
		{"title":"a/b","lines":["a/b","body"]},
		{"title":"c","lines":["c"]},
		{"title":"gone","lines":["gone"]}
	]}`)
	yjsServer = nil // no room is loaded: every card is read from its stored log
	softDelete(t, app, cardInPot(t, app, src.Id, "gone"))

	var buf bytes.Buffer
	result, err := Export(app, &buf)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	if result != (ExportResult{Pots: 2, Cards: 2}) {
		t.Errorf("result = %+v, want 2 pots and 2 cards", result)
	}

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

	want := map[string]string{
		src.Id + "/":           "",
		src.Id + "/a%2Fb.csn":  "a/b\nbody",
		src.Id + "/c.csn":      "c",
		empty.Id + "/":         "",
	}
	if !maps.Equal(got, want) {
		t.Errorf("archive = %q, want %q", got, want)
	}
}
