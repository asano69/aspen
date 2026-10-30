package serve

import (
	"errors"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/aspen/internal/parser"
)

const (
	testDiagram = "code:fake\n\tnode a"
	testPNG     = "[https://example.com/a.png]"
)

// useFakeRenderer registers a renderer for "fake" code blocks for one test.
// Its source "bad" fails to render.
func useFakeRenderer(t *testing.T, variant string) {
	t.Helper()
	previous := diagramRenderers
	diagramRenderers = []diagramRenderer{{
		language: "fake",
		kind:     "fake",
		variant:  variant,
		render: func(source string) ([]byte, error) {
			if strings.Contains(source, "bad") {
				return nil, errors.New("bad source")
			}
			return []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), nil
		},
	}}
	t.Cleanup(func() { diagramRenderers = previous })
}

// newThumbnailTestApp extends newSlugTestApp with the "renders" collection.
func newThumbnailTestApp(t *testing.T) core.App {
	t.Helper()
	app := newSlugTestApp(t)

	renders := core.NewBaseCollection("renders")
	renders.Fields.Add(
		&core.TextField{Name: "kind"},
		&core.TextField{Name: "content_hash"},
		&core.FileField{Name: "output_file", MaxSelect: 1},
	)
	if err := app.Save(renders); err != nil {
		t.Fatalf("create renders collection: %v", err)
	}
	return app
}

func countRenders(t *testing.T, app core.App) int64 {
	t.Helper()
	n, err := app.CountRecords("renders")
	if err != nil {
		t.Fatalf("count renders: %v", err)
	}
	return n
}

func TestThumbnailSrc_RendersOnceAndReusesIt(t *testing.T) {
	useFakeRenderer(t, "v1")
	app := newThumbnailTestApp(t)
	note := parser.Parse("T\n" + testDiagram)

	first := thumbnailSrc(app, note)
	if !strings.HasPrefix(first, "/api/files/") || !strings.HasSuffix(first, ".svg") {
		t.Fatalf("thumbnail = %q, want an /api/files/ URL of an .svg", first)
	}
	if second := thumbnailSrc(app, note); second != first {
		t.Errorf("second thumbnail = %q, want the same %q", second, first)
	}
	if n := countRenders(t, app); n != 1 {
		t.Errorf("got %d renders, want 1", n)
	}
}

func TestThumbnailSrc_FirstInDocumentOrderWins(t *testing.T) {
	useFakeRenderer(t, "v1")
	app := newThumbnailTestApp(t)

	if got := thumbnailSrc(app, parser.Parse("T\n"+testPNG+"\n"+testDiagram)); got != "https://example.com/a.png" {
		t.Errorf("image first: thumbnail = %q, want the image", got)
	}
	if n := countRenders(t, app); n != 0 {
		t.Errorf("got %d renders, want 0: a diagram after the image must not be rendered", n)
	}

	if got := thumbnailSrc(app, parser.Parse("T\n"+testDiagram+"\n"+testPNG)); !strings.HasPrefix(got, "/api/files/") {
		t.Errorf("diagram first: thumbnail = %q, want the diagram", got)
	}
}

func TestThumbnailSrc_UnrenderableDiagramFallsBackToLaterImage(t *testing.T) {
	useFakeRenderer(t, "v1")
	app := newThumbnailTestApp(t)
	note := parser.Parse("T\ncode:fake\n\tbad\n" + testPNG)

	if got := thumbnailSrc(app, note); got != "https://example.com/a.png" {
		t.Errorf("thumbnail = %q, want the image", got)
	}
	if n := countRenders(t, app); n != 0 {
		t.Errorf("got %d renders, want 0", n)
	}
}

func TestThumbnailSrc_LanguageWithoutRendererIsIgnored(t *testing.T) {
	useFakeRenderer(t, "v1")
	app := newThumbnailTestApp(t)

	if got := thumbnailSrc(app, parser.Parse("T\ncode:mermaid\n\tgraph TD\n"+testPNG)); got != "https://example.com/a.png" {
		t.Errorf("thumbnail = %q, want the image", got)
	}
	if got := thumbnailSrc(app, parser.Parse("T\nplain\ncode:ts\n\tx")); got != "" {
		t.Errorf("thumbnail = %q, want empty", got)
	}
	if n := countRenders(t, app); n != 0 {
		t.Errorf("got %d renders, want 0", n)
	}
}

func TestThumbnailSrc_LanguageMatchesLikeTheEditor(t *testing.T) {
	useFakeRenderer(t, "v1")
	app := newThumbnailTestApp(t)

	for _, decl := range []string{"code:FAKE", "code: fake", "code:diagram.x(fake)"} {
		if got := thumbnailSrc(app, parser.Parse("T\n"+decl+"\n\tnode a")); !strings.HasPrefix(got, "/api/files/") {
			t.Errorf("%q: thumbnail = %q, want a render", decl, got)
		}
	}
}

func TestRenderHash_DependsOnEveryInput(t *testing.T) {
	base := renderHash("k", "v1", "src")
	for name, other := range map[string]string{
		"kind":    renderHash("k2", "v1", "src"),
		"variant": renderHash("k", "v2", "src"),
		"source":  renderHash("k", "v1", "src2"),
		"split":   renderHash("kv", "1", "src"),
	} {
		if other == base {
			t.Errorf("changing the %s did not change the hash", name)
		}
	}
}
