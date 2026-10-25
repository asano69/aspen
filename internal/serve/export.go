// export.go implements "cardpod export": it writes one pod to a directory.
//
//	<dir>/
//	├── manifest.json                 cards and assets, in export order
//	├── assets/<recordId>/<file>      attachments used by the cards
//	└── cards/
//	    ├── <stem>.csn                the text of a card
//	    └── <stem>.json               the signed lines of a card
//
// Cards are written in titleLc order. <stem> is the card's title made safe as a
// file name and cut to maxStemBytes. When two stems are the same (compared
// case-insensitively, as some file systems do), a later one gets "(2)", "(3)", ...
// so no name collides. The manifest lists every file, so an importer needs no
// knowledge of the naming rules and reads cards in the listed order.
//
// Like import, the command opens the data directory in its own process, so run
// it while the server is stopped: the text is read from the content rows, which
// can be a moment behind a card the running server has open.
package serve

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/spf13/pathologize"

	"github.com/asano69/cardpod/internal/lineid"
	"github.com/asano69/cardpod/internal/parser"
)

const (
	exportTextExt  = ".csn"
	exportLinesExt = ".json"

	// maxStemBytes caps the readable part of a file name. Most file systems
	// limit a name to 255 bytes, so the longest suffix (".json", 5 bytes) still
	// fits. A "(<n>)" suffix is taken out of this budget, not added to it.
	maxStemBytes = 240

	// fallbackStem is used when a title has nothing left after sanitizing.
	fallbackStem = "untitled"

	manifestName = "manifest.json"
)

// ExportResult counts what an export wrote.
type ExportResult struct {
	Cards  int
	Assets int
}

// manifestCard lists the two files of one card.
type manifestCard struct {
	Text  string `json:"text"`
	Lines string `json:"lines"`
}

// manifest is the content of manifest.json. Paths are relative to the export
// directory and use "/".
type manifest struct {
	Cards  []manifestCard `json:"cards"`
	Assets []string       `json:"assets"`
}

// Export writes every live card of the pod named podName, and the attachments
// they use, into dir.
func Export(app core.App, podName, dir string) (ExportResult, error) {
	var result ExportResult

	pod, err := app.FindFirstRecordByFilter(
		"pods", "name = {:name} && "+notDeleted, dbx.Params{"name": podName},
	)
	if errors.Is(err, sql.ErrNoRows) {
		return result, fmt.Errorf("pod %q not found", podName)
	}
	if err != nil {
		return result, fmt.Errorf("find pod %q: %w", podName, err)
	}

	// Created up front, so empty folders exist too.
	for _, sub := range []string{"cards", "assets"} {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o755); err != nil {
			return result, fmt.Errorf("create %s: %w", sub, err)
		}
	}

	cards, err := app.FindRecordsByFilter(
		"cards", "pod = {:pod} && "+notDeleted, "titleLc", 0, 0,
		dbx.Params{"pod": pod.Id},
	)
	if err != nil {
		return result, fmt.Errorf("list cards: %w", err)
	}

	m := manifest{Cards: []manifestCard{}, Assets: []string{}}
	used := map[string]bool{}
	assets := map[string]bool{}
	for _, card := range cards {
		text, err := loadCardText(app, card)
		if err != nil {
			return result, err
		}
		lines, err := currentLines(app, card)
		if err != nil {
			return result, fmt.Errorf("read the lines of card %s: %w", card.Id, err)
		}

		stem := uniqueStem(exportStem(card.GetString("title")), used)
		entry := manifestCard{
			Text:  "cards/" + stem + exportTextExt,
			Lines: "cards/" + stem + exportLinesExt,
		}
		if err := exportCard(dir, entry, text, lines); err != nil {
			return result, fmt.Errorf("export card %s: %w", card.Id, err)
		}
		m.Cards = append(m.Cards, entry)
		for _, id := range attachmentIDs(text) {
			assets[id] = true
		}
	}

	m.Assets, err = exportAssets(app, dir, slices.Sorted(maps.Keys(assets)))
	if err != nil {
		return result, err
	}

	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return result, fmt.Errorf("encode manifest: %w", err)
	}
	if err := writeFile(dir, manifestName, data); err != nil {
		return result, err
	}

	result.Cards, result.Assets = len(m.Cards), len(m.Assets)
	return result, nil
}

// exportCard writes the text and the signed lines of one card.
func exportCard(dir string, entry manifestCard, text string, lines []lineid.Line) error {
	if err := writeFile(dir, entry.Text, []byte(text)); err != nil {
		return err
	}
	if lines == nil {
		lines = []lineid.Line{} // encode "no lines" as [], not null
	}
	data, err := json.Marshal(lines)
	if err != nil {
		return fmt.Errorf("encode lines: %w", err)
	}
	return writeFile(dir, entry.Lines, data)
}

// exportStem makes a card title safe as the readable part of a file name on
// every OS, and short enough to leave room for the suffix.
func exportStem(title string) string {
	// pathologize.Clean turns an empty name into "file", which would hide
	// the fallback below, so a blank title is handled first.
	if strings.TrimSpace(title) == "" {
		return fallbackStem
	}
	stem := strings.TrimSpace(truncateBytes(pathologize.Clean(title), maxStemBytes))
	if stem == "" {
		return fallbackStem
	}
	return stem
}

// uniqueStem returns stem, or stem with "(2)", "(3)", ... when a name that
// differs only in case is already in used, and records the result. The suffix
// is taken out of the length budget by cutting stem, so the name never exceeds
// maxStemBytes.
func uniqueStem(stem string, used map[string]bool) string {
	name := stem
	for n := 2; used[strings.ToLower(name)]; n++ {
		suffix := fmt.Sprintf("(%d)", n)
		name = truncateBytes(stem, maxStemBytes-len(suffix)) + suffix
	}
	used[strings.ToLower(name)] = true
	return name
}

// truncateBytes cuts s to at most max bytes without splitting a character.
func truncateBytes(s string, max int) string {
	if len(s) <= max {
		return s
	}
	for max > 0 && !utf8.RuneStart(s[max]) {
		max--
	}
	return s[:max]
}

// attachmentIDs returns the record ids of the attachments an image notation
// in text refers to ("@/<recordId>/<filename>").
func attachmentIDs(text string) []string {
	var ids []string
	parser.Parse(text).Walk(func(n *parser.Node) bool {
		if n.Kind == parser.KindImage || n.Kind == parser.KindLinkedImage {
			if id, ok := attachmentID(n.Text); ok {
				ids = append(ids, id)
			}
		}
		return true
	})
	return ids
}

func attachmentID(src string) (string, bool) {
	rest, ok := strings.CutPrefix(src, "@/")
	if !ok {
		return "", false
	}
	id, _, ok := strings.Cut(rest, "/")
	return id, ok
}

// exportAssets writes the attachments with the given record ids to
// assets/<recordId>/<file> and returns their paths, relative to dir.
func exportAssets(app core.App, dir string, ids []string) ([]string, error) {
	written := []string{}
	if len(ids) == 0 {
		return written, nil
	}
	fsys, err := app.NewFilesystem()
	if err != nil {
		return nil, fmt.Errorf("open file storage: %w", err)
	}
	defer fsys.Close()

	for _, id := range ids {
		rel, err := exportAsset(app, fsys, dir, id)
		if err != nil {
			return nil, fmt.Errorf("export attachment %s: %w", id, err)
		}
		if rel != "" {
			written = append(written, rel)
		}
	}
	return written, nil
}

// exportAsset writes one attachment and returns its path relative to dir. An
// attachment that no longer exists is skipped (the note keeps pointing at it,
// as it did before the export) and gives "".
func exportAsset(app core.App, fsys *filesystem.System, dir, id string) (string, error) {
	record, err := app.FindRecordById("attachments", id)
	if errors.Is(err, sql.ErrNoRows) {
		slog.Warn("export: attachment not found", "attachment", id)
		return "", nil
	}
	if err != nil {
		return "", err
	}
	name := record.GetString("image")
	if name == "" {
		return "", nil
	}

	reader, err := fsys.GetReader(record.BaseFilesPath() + "/" + name)
	if err != nil {
		return "", err
	}
	defer reader.Close()

	rel := "assets/" + id + "/" + name
	path := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	f, err := os.Create(path)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(f, reader); err != nil {
		f.Close()
		return "", err
	}
	return rel, f.Close()
}

// writeFile writes data to rel (a "/" path) inside dir, creating its folder.
func writeFile(dir, rel string, data []byte) error {
	path := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("write %s: %w", rel, err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", rel, err)
	}
	return nil
}
