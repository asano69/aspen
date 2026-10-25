// export.go implements "cardpod export": it writes one pot to a zip archive.
//
// The top folder of the archive is the pot's name, which the pots collection
// limits to letters, digits and hyphens, so it is safe on every OS:
//
//	<pot-name>/
//	├── manifest.json                       (empty for now)
//	├── assets/<recordId>/<file>            attachments used by the cards
//	└── cards/
//	    ├── <stem>.<cardId>.csn             the text of a card
//	    └── <stem>.<cardId>.sig.json        the signed lines of a card
//
// <stem> is the card's title made safe as a file name and cut to
// maxStemBytes. It is only there to be readable: the card id after it makes
// every name unique, so titles that sanitize to the same stem never collide,
// and the importer can ignore file names altogether.
//
// Like import, the command opens the data directory in its own process, so run
// it while the server is stopped: the text is read from the content rows, which
// can be a moment behind a card the running server has open.
package serve

import (
	"archive/zip"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
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
	exportTextExt = ".csn"
	exportSigExt  = ".sig.json"

	// maxStemBytes caps the readable part of a file name. The suffix
	// (".<15-char id>.sig.json", 25 bytes) is added after it. Most file
	// systems limit a name to 255 bytes, so this leaves a wide margin for
	// longer suffixes later.
	maxStemBytes = 200

	// fallbackStem is used when a title has nothing left after sanitizing.
	fallbackStem = "untitled"
)

// ExportResult counts what an export wrote.
type ExportResult struct {
	Cards  int
	Assets int
}

// Export writes every live card of the pot named potName, and the attachments
// they use, to w as a zip archive.
func Export(app core.App, potName string, w io.Writer) (ExportResult, error) {
	var result ExportResult

	pot, err := app.FindFirstRecordByFilter(
		"pots", "name = {:name} && "+notDeleted, dbx.Params{"name": potName},
	)
	if errors.Is(err, sql.ErrNoRows) {
		return result, fmt.Errorf("pot %q not found", potName)
	}
	if err != nil {
		return result, fmt.Errorf("find pot %q: %w", potName, err)
	}

	root := pot.GetString("name")
	zw := zip.NewWriter(w)

	// Explicit folder entries keep empty folders in the archive.
	for _, dir := range []string{"", "assets/", "cards/"} {
		if err := writeEntry(zw, root+"/"+dir, nil); err != nil {
			return result, err
		}
	}
	if err := writeEntry(zw, root+"/manifest.json", nil); err != nil {
		return result, err
	}

	cards, err := app.FindRecordsByFilter(
		"cards", "pot = {:pot} && "+notDeleted, "title", 0, 0,
		dbx.Params{"pot": pot.Id},
	)
	if err != nil {
		return result, fmt.Errorf("list cards: %w", err)
	}

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
		if err := exportCard(zw, root+"/cards/", card, text, lines); err != nil {
			return result, err
		}
		result.Cards++
		for _, id := range attachmentIDs(text) {
			assets[id] = true
		}
	}

	result.Assets, err = exportAssets(app, zw, root, slices.Sorted(maps.Keys(assets)))
	if err != nil {
		return result, err
	}
	if err := zw.Close(); err != nil {
		return result, fmt.Errorf("finish archive: %w", err)
	}
	return result, nil
}

// exportCard writes the text and the signed lines of one card into dir.
func exportCard(zw *zip.Writer, dir string, card *core.Record, text string, lines []lineid.Line) error {
	base := dir + exportStem(card.GetString("title")) + "." + card.Id

	if err := writeEntry(zw, base+exportTextExt, []byte(text)); err != nil {
		return err
	}
	if lines == nil {
		lines = []lineid.Line{} // encode "no lines" as [], not null
	}
	sig, err := json.Marshal(lines)
	if err != nil {
		return fmt.Errorf("encode the lines of card %s: %w", card.Id, err)
	}
	return writeEntry(zw, base+exportSigExt, sig)
}

// exportStem makes a card title safe as the readable part of a file name on
// every OS, and short enough to leave room for the suffix.
func exportStem(title string) string {
	stem := strings.TrimSpace(truncateBytes(pathologize.Clean(title), maxStemBytes))
	if stem == "" {
		return fallbackStem
	}
	return stem
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
// <root>/assets/<recordId>/<file> and returns how many were written.
func exportAssets(app core.App, zw *zip.Writer, root string, ids []string) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	fsys, err := app.NewFilesystem()
	if err != nil {
		return 0, fmt.Errorf("open file storage: %w", err)
	}
	defer fsys.Close()

	written := 0
	for _, id := range ids {
		ok, err := exportAsset(app, fsys, zw, root, id)
		if err != nil {
			return written, fmt.Errorf("export attachment %s: %w", id, err)
		}
		if ok {
			written++
		}
	}
	return written, nil
}

// exportAsset writes one attachment. An attachment that no longer exists is
// skipped (the note keeps pointing at it, as it did before the export), and
// reported as false.
func exportAsset(app core.App, fsys *filesystem.System, zw *zip.Writer, root, id string) (bool, error) {
	record, err := app.FindRecordById("attachments", id)
	if errors.Is(err, sql.ErrNoRows) {
		slog.Warn("export: attachment not found", "attachment", id)
		return false, nil
	}
	if err != nil {
		return false, err
	}
	name := record.GetString("image")
	if name == "" {
		return false, nil
	}

	reader, err := fsys.GetReader(record.BaseFilesPath() + "/" + name)
	if err != nil {
		return false, err
	}
	defer reader.Close()

	f, err := zw.Create(root + "/assets/" + id + "/" + name)
	if err != nil {
		return false, err
	}
	if _, err := io.Copy(f, reader); err != nil {
		return false, err
	}
	return true, nil
}

// writeEntry adds one entry to the archive. A name ending in "/" is a folder.
func writeEntry(zw *zip.Writer, name string, data []byte) error {
	f, err := zw.Create(name)
	if err != nil {
		return fmt.Errorf("write %s: %w", name, err)
	}
	if _, err := f.Write(data); err != nil {
		return fmt.Errorf("write %s: %w", name, err)
	}
	return nil
}
