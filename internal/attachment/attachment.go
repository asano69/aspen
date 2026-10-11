// Package attachment normalizes uploaded images before they are stored.
// Each supported MIME type has its own processor, so adding a format means
// adding one entry to processors (and nothing else in this package).
package attachment

import (
	"errors"
	"fmt"
	"image"
	"math"

	"golang.org/x/image/draw"
)

const (
	// MaxWidth and MaxHeight bound the stored image. The aspect ratio is kept.
	MaxWidth  = 694
	MaxHeight = 1000
	// maxPixels rejects images that would need too much memory to decode.
	maxPixels = 50_000_000
)

// ErrUnsupported is returned for an image type that has no processor.
var ErrUnsupported = errors.New("unsupported image type")

// Result is a processed image ready to be stored.
type Result struct {
	Data []byte
	// Ext is the file extension, with its leading dot (e.g. ".png").
	Ext string
}

type processor func(data []byte) (Result, error)

// processors maps a detected MIME type to its processor. The format of an
// image is never converted: a processor returns the same format it received.
var processors = map[string]processor{
	"image/png": processPNG,
}

// Process normalizes data according to its MIME type.
func Process(mimeType string, data []byte) (Result, error) {
	p, ok := processors[mimeType]
	if !ok {
		return Result{}, fmt.Errorf("%w: %s", ErrUnsupported, mimeType)
	}
	return p(data)
}

// fit scales src down so it fits within MaxWidth x MaxHeight, keeping its
// aspect ratio. An image that already fits is returned unchanged (never
// enlarged).
func fit(src image.Image) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	scale := math.Min(float64(MaxWidth)/float64(w), float64(MaxHeight)/float64(h))
	if scale >= 1 {
		return src
	}
	newW := max(1, int(math.Round(float64(w)*scale)))
	newH := max(1, int(math.Round(float64(h)*scale)))

	// NRGBA keeps semi-transparent edges correct.
	dst := image.NewNRGBA(image.Rect(0, 0, newW, newH))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	return dst
}
