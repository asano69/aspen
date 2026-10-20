// thumbnail.go picks a card's thumbnail (the "image" field) from its text:
// the first image or renderable diagram in document order. A diagram is
// rendered to SVG on the server by the renderer registered for its code block
// language (see diagramRenderers) and stored in the "renders" collection,
// keyed by a hash of its source, so the same diagram is rendered once however
// many cards use it. The card's image is then the URL PocketBase serves that
// file under.
package serve

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"

	"github.com/asano69/cardpod/internal/parser"
)

// diagramRenderer renders the source of a code block to an SVG.
type diagramRenderer struct {
	// language is the code block language it handles, compared
	// case-insensitively (see parser.Node.CodeLanguage).
	language string
	// kind is stored in the "kind" field of the renders it produces, so it
	// must be one of that select field's values.
	kind string
	// variant identifies everything besides the source that affects the
	// output (theme, renderer settings). Changing it makes existing renders
	// stale: the same source is then rendered again under a new hash.
	variant string
	render  func(source string) ([]byte, error)
}

// diagramRenderers lists the languages whose code blocks get a rendered
// thumbnail. It is empty for now: supporting another diagram language (for
// example Graphviz) on the server is one entry here, plus its value in the
// "kind" field of the "renders" collection. A go-mermaid renderer was tried
// and dropped for its quality.
var diagramRenderers []diagramRenderer

func rendererFor(language string) *diagramRenderer {
	for i := range diagramRenderers {
		if strings.EqualFold(diagramRenderers[i].language, language) {
			return &diagramRenderers[i]
		}
	}
	return nil
}

// thumbnailSrc returns the thumbnail of a note: the first image or renderable
// diagram in document order, or "" when there is none. A diagram that cannot
// be rendered is skipped, so a later image can still be used.
func thumbnailSrc(app core.App, note *parser.Note) string {
	src := ""
	note.Walk(func(n *parser.Node) bool {
		if n.Kind == parser.KindImage || n.Kind == parser.KindLinkedImage {
			src = n.Text
			return false
		}
		if n.Kind != parser.KindCodeBlock || strings.TrimSpace(n.BodyText()) == "" {
			return true
		}
		renderer := rendererFor(n.CodeLanguage())
		if renderer == nil {
			return true
		}
		url, err := renderedURL(app, *renderer, n.BodyText())
		if err != nil {
			slog.Warn("render diagram thumbnail", "kind", renderer.kind, "error", err)
			return true
		}
		src = url
		return false
	})
	return src
}

// renderedURL returns the URL of the SVG of a diagram source, rendering and
// storing it first when no render of it exists yet.
func renderedURL(app core.App, renderer diagramRenderer, source string) (string, error) {
	hash := renderHash(renderer.kind, renderer.variant, source)

	record, err := app.FindFirstRecordByFilter(
		"renders", "kind = {:kind} && content_hash = {:hash}",
		dbx.Params{"kind": renderer.kind, "hash": hash},
	)
	if errors.Is(err, sql.ErrNoRows) {
		record, err = createRender(app, renderer, hash, source)
	}
	if err != nil {
		return "", err
	}
	return "/api/files/" + record.BaseFilesPath() + "/" + record.GetString("output_file"), nil
}

// createRender renders source and saves the SVG as a new "renders" record
// whose content_hash is hash.
func createRender(app core.App, renderer diagramRenderer, hash, source string) (*core.Record, error) {
	svg, err := renderer.render(source)
	if err != nil {
		return nil, fmt.Errorf("render %s: %w", renderer.kind, err)
	}
	file, err := filesystem.NewFileFromBytes(svg, renderer.kind+".svg")
	if err != nil {
		return nil, fmt.Errorf("make render file: %w", err)
	}
	collection, err := app.FindCollectionByNameOrId("renders")
	if err != nil {
		return nil, err
	}

	record := core.NewRecord(collection)
	record.Set("kind", renderer.kind)
	record.Set("content_hash", hash)
	record.Set("output_file", file)
	if err := app.Save(record); err != nil {
		return nil, fmt.Errorf("save render: %w", err)
	}
	return record, nil
}

// renderHash identifies a render by everything that affects its output. The
// NUL separators keep ("a", "bc") and ("ab", "c") from hashing alike.
func renderHash(kind, variant, source string) string {
	sum := sha256.Sum256([]byte(kind + "\x00" + variant + "\x00" + source))
	return hex.EncodeToString(sum[:])
}
