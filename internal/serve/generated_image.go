// generated_image.go holds the logic shared by every generated image: a
// default image that is made for a record from a seed text (a pod's title, a
// user's name) so the UI never has to fall back to a placeholder. It is
// provisional: an image the user uploads replaces it and is never overwritten
// afterwards. Each kind of image is one generatedImage value (see
// pod_cover.go and user_avatar.go).
package serve

import (
	"bytes"
	"io"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// generatedImage describes one generated image field of one collection.
type generatedImage struct {
	collection string
	// field is the name of the file field that holds the image.
	field string
	// fileName is the name the generated file is stored under (PocketBase adds
	// a random suffix to it).
	fileName string
	// seed returns the text the image is generated from.
	seed func(record *core.Record) string
	// svg returns the generated image for a seed. It must be deterministic, so
	// the same seed always gives the same bytes.
	svg func(seed string) []byte
}

// generatedImages lists every generated image whose hooks are registered.
var generatedImages = []generatedImage{podCover, userAvatar}

// registerGeneratedImageHooks registers the hooks of every generated image.
func registerGeneratedImageHooks(app core.App) {
	for _, g := range generatedImages {
		g.register(app)
	}
}

// newFile wraps the generated image of seed as a file to store.
func (g generatedImage) newFile(seed string) (*filesystem.File, error) {
	return filesystem.NewFileFromBytes(g.svg(seed), g.fileName)
}

// set sets the record's image to the generated one of its seed. Setting a new
// file on a single-file field replaces (and deletes) the old one. A failure is
// only logged: it must never prevent the record from being saved.
func (g generatedImage) set(record *core.Record) {
	file, err := g.newFile(g.seed(record))
	if err != nil {
		slog.Warn("make generated image", "collection", g.collection, "record", record.Id, "error", err)
		return
	}
	record.Set(g.field, file)
}

// isGenerated reports whether the stored image of record is exactly what we
// would have generated for seed. Comparing the content (not the file name) is
// what tells our image from one the user uploaded.
func (g generatedImage) isGenerated(app core.App, record *core.Record, seed string) (bool, error) {
	fsys, err := app.NewFilesystem()
	if err != nil {
		return false, err
	}
	defer fsys.Close()

	reader, err := fsys.GetReader(record.BaseFilesPath() + "/" + record.GetString(g.field))
	if err != nil {
		return false, err
	}
	defer reader.Close()

	stored, err := io.ReadAll(reader)
	if err != nil {
		return false, err
	}
	return bytes.Equal(stored, g.svg(seed)), nil
}

// shouldRegenerate decides whether an update must replace the image: only when
// the seed changed and the current image is missing or still a generated one.
func (g generatedImage) shouldRegenerate(e *core.RecordEvent) bool {
	original := e.Record.Original()
	oldSeed, newSeed := g.seed(original), g.seed(e.Record)
	if oldSeed == newSeed {
		return false
	}
	// The user is changing the image in this very request: leave it alone.
	if len(e.Record.GetUnsavedFiles(g.field)) > 0 ||
		e.Record.GetString(g.field) != original.GetString(g.field) {
		return false
	}
	if original.GetString(g.field) == "" {
		return true
	}
	generated, err := g.isGenerated(e.App, original, oldSeed)
	if err != nil {
		slog.Warn("check generated image", "collection", g.collection, "record", e.Record.Id, "error", err)
		return false
	}
	return generated
}

// register generates the image of a new record that has none, and regenerates
// it when the seed changes, but only while the current image is still a
// generated one.
func (g generatedImage) register(app core.App) {
	app.OnRecordCreate(g.collection).BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString(g.field) == "" && len(e.Record.GetUnsavedFiles(g.field)) == 0 {
			g.set(e.Record)
		}
		return e.Next()
	})

	app.OnRecordUpdate(g.collection).BindFunc(func(e *core.RecordEvent) error {
		if g.shouldRegenerate(e) {
			g.set(e.Record)
		}
		return e.Next()
	})
}
