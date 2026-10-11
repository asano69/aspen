package attachment

import (
	"bytes"
	"image"
	"image/png"
	"testing"
)

func encodePNG(t *testing.T, w, h int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewNRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatalf("encode: %v", err)
	}
	return buf.Bytes()
}

func size(t *testing.T, data []byte) (int, int) {
	t.Helper()
	cfg, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decode config: %v", err)
	}
	return cfg.Width, cfg.Height
}

func TestProcessPNG_ShrinksTallImageKeepingAspectRatio(t *testing.T) {
	res, err := Process("image/png", encodePNG(t, 1000, 3000))
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	// Height is the limiting side: 3000 -> 1000, so 1000 -> 333.
	if w, h := size(t, res.Data); w != 333 || h != 1000 {
		t.Errorf("size = %dx%d, want 333x1000", w, h)
	}
}

func TestProcessPNG_NeverEnlarges(t *testing.T) {
	res, err := Process("image/png", encodePNG(t, 100, 50))
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if w, h := size(t, res.Data); w != 100 || h != 50 {
		t.Errorf("size = %dx%d, want 100x50", w, h)
	}
}

func TestProcessPNG_ClampsDPI(t *testing.T) {
	// A 300 dpi source is lowered to 96; no pHYs becomes 72.
	cases := []struct {
		name string
		in   []byte
		want float64
	}{
		{"high", withDPI(encodePNG(t, 10, 10), 300), 96},
		{"missing", encodePNG(t, 10, 10), 72},
	}
	for _, c := range cases {
		res, err := Process("image/png", c.in)
		if err != nil {
			t.Fatalf("%s: Process: %v", c.name, err)
		}
		got := readDPI(res.Data)
		if got < c.want-0.1 || got > c.want+0.1 {
			t.Errorf("%s: dpi = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestProcess_UnsupportedType(t *testing.T) {
	if _, err := Process("image/bmp", nil); err == nil {
		t.Error("want an error for an unsupported type")
	}
}
