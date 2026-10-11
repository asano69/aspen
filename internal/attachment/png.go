package attachment

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"image/png"
	"math"
)

const (
	pngSignature = "\x89PNG\r\n\x1a\n"
	// ihdrEnd is the offset right after the IHDR chunk: the signature (8)
	// plus IHDR's length, type, 13 data bytes and CRC (25).
	ihdrEnd = 33

	minDPI = 72.0
	maxDPI = 96.0
	// inchPerMeter converts pixels per meter (pHYs) to dots per inch.
	inchPerMeter = 0.0254
)

// processPNG decodes, shrinks and re-encodes a PNG. Re-encoding drops every
// ancillary chunk (text, EXIF, ...), then the resolution is written back
// clamped to [minDPI, maxDPI].
func processPNG(data []byte) (Result, error) {
	cfg, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return Result{}, fmt.Errorf("invalid PNG image: %w", err)
	}
	if cfg.Width*cfg.Height > maxPixels {
		return Result{}, errors.New("the image has too many pixels")
	}

	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return Result{}, fmt.Errorf("invalid PNG image: %w", err)
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, fit(img)); err != nil {
		return Result{}, fmt.Errorf("encode PNG image: %w", err)
	}
	return Result{Data: withDPI(buf.Bytes(), clampDPI(readDPI(data))), Ext: ".png"}, nil
}

// clampDPI limits dpi to [minDPI, maxDPI]. An unknown resolution (0) becomes
// minDPI.
func clampDPI(dpi float64) float64 {
	return math.Min(math.Max(dpi, minDPI), maxDPI)
}

// readDPI returns the horizontal resolution stored in the pHYs chunk of a
// PNG, or 0 when there is none (or its unit is not the meter).
func readDPI(data []byte) float64 {
	pos := len(pngSignature)
	for pos+8 <= len(data) {
		length := int(binary.BigEndian.Uint32(data[pos:]))
		kind := string(data[pos+4 : pos+8])
		body := pos + 8
		if body+length > len(data) || kind == "IDAT" {
			break
		}
		if kind == "pHYs" && length == 9 && data[body+8] == 1 {
			return float64(binary.BigEndian.Uint32(data[body:])) * inchPerMeter
		}
		pos = body + length + 4 // skip the CRC too
	}
	return 0
}

// withDPI inserts a pHYs chunk right after the IHDR chunk of an encoded PNG
// (Go's encoder never writes one, so there is nothing to replace).
func withDPI(encoded []byte, dpi float64) []byte {
	chunk := pHYsChunk(dpi)
	out := make([]byte, 0, len(encoded)+len(chunk))
	out = append(out, encoded[:ihdrEnd]...)
	out = append(out, chunk...)
	return append(out, encoded[ihdrEnd:]...)
}

// pHYsChunk builds a complete pHYs chunk (length, type, data, CRC) for dpi on
// both axes.
func pHYsChunk(dpi float64) []byte {
	perMeter := uint32(math.Round(dpi / inchPerMeter))

	chunk := binary.BigEndian.AppendUint32(nil, 9)
	chunk = append(chunk, "pHYs"...)
	chunk = binary.BigEndian.AppendUint32(chunk, perMeter) // x
	chunk = binary.BigEndian.AppendUint32(chunk, perMeter) // y
	chunk = append(chunk, 1)                               // unit: meter
	return binary.BigEndian.AppendUint32(chunk, crc32.ChecksumIEEE(chunk[4:]))
}
