// pod_cover.go gives every pod a generated cover image, so the pod grid does
// not have to fall back to the app logo (see generated_image.go).
package serve

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/sig-0/boring-avatars-go/avatars"
)

// coverSize is the width and height of the generated SVG, in pixels.
const coverSize = 240

// coverPalette is the marble palette used for generated covers.
var coverPalette = []string{"#00686c", "#32c2b9", "#edecb3", "#fad928", "#ff9915"}

var podCover = generatedImage{
	collection: "pods",
	field:      "cover",
	fileName:   "cover.svg",
	seed:       func(pod *core.Record) string { return pod.GetString("title") },
	svg: func(title string) []byte {
		return []byte(avatars.Generate(avatars.Marble, title, coverPalette, coverSize, true))
	},
}

// NewCoverFile wraps the generated cover of title as a file to store. It is
// exported for scripts/regenerate_pod_covers.
func NewCoverFile(title string) (*filesystem.File, error) {
	return podCover.newFile(title)
}
