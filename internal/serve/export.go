// export.go implements "cardpod export": it writes the current state of every
// card to a zip archive. Each live pot becomes a folder named after the pot's
// id, and each live card in it a ".csn" (Cosense) file named after its title,
// holding the card's full text.
//
// Like import, the command opens the data directory in its own process, so run
// it while the server is stopped: the text is read from the note files, which
// can be a moment behind a card the running server has open.
package serve

import (
	"archive/zip"
	"fmt"
	"io"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// exportExt is the extension of an exported card file.
const exportExt = ".csn"

// ExportResult counts what an export wrote.
type ExportResult struct {
	Pots  int
	Cards int
}

// fileNameEscaper makes a title safe as a single zip path segment. "%" is
// escaped too, so two different titles never end up with the same name.
var fileNameEscaper = strings.NewReplacer("%", "%25", "/", "%2F", `\`, "%5C")

// Export writes every live card of every live pot to w as a zip archive.
func Export(app core.App, w io.Writer) (ExportResult, error) {
	var result ExportResult

	pots, err := app.FindRecordsByFilter("pots", notDeleted, "", 0, 0)
	if err != nil {
		return result, fmt.Errorf("list pots: %w", err)
	}

	zw := zip.NewWriter(w)
	for _, pot := range pots {
		// An explicit folder entry keeps a pot without cards in the archive.
		if _, err := zw.Create(pot.Id + "/"); err != nil {
			return result, fmt.Errorf("write folder of pot %s: %w", pot.Id, err)
		}
		n, err := exportPot(app, zw, pot.Id)
		if err != nil {
			return result, fmt.Errorf("export pot %s: %w", pot.Id, err)
		}
		result.Pots++
		result.Cards += n
	}
	if err := zw.Close(); err != nil {
		return result, fmt.Errorf("finish archive: %w", err)
	}
	return result, nil
}

// exportPot writes the live cards of one pot into its folder and returns how
// many were written.
func exportPot(app core.App, zw *zip.Writer, potID string) (int, error) {
	cards, err := app.FindRecordsByFilter(
		"cards", "pot = {:pot} && "+notDeleted, "title", 0, 0,
		dbx.Params{"pot": potID},
	)
	if err != nil {
		return 0, fmt.Errorf("list cards: %w", err)
	}

	for _, card := range cards {
		text, err := loadCardText(app, card)
		if err != nil {
			return 0, err
		}
		name := potID + "/" + fileNameEscaper.Replace(card.GetString("title")) + exportExt
		f, err := zw.Create(name)
		if err != nil {
			return 0, fmt.Errorf("write %s: %w", name, err)
		}
		if _, err := io.WriteString(f, text); err != nil {
			return 0, fmt.Errorf("write %s: %w", name, err)
		}
	}
	return len(cards), nil
}
