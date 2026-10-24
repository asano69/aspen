// import.go implements "cardpod import": it loads pages from a JSON export
// into one pot. A card body is written to its content row (see contents.go),
// the same way a live editing session stores it. Only the card record itself (pot,
// title, position) is created the way createCardHandler creates it.
//
// The command opens the data directory in its own process, so run it while
// the server is stopped: a card the running server already has open would not
// see the imported content.
package serve

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpod/internal/slug"
)

// The JSON layout accepted by Import is {"pages": [...]}. Unknown fields are
// ignored so richer exports can be fed in unchanged.
type importPage struct {
	Title string      `json:"title"`
	Lines importLines `json:"lines"`
}

// importLines is the "lines" array of a page. Each entry is either a plain
// string (the simple format) or an object with a "text" field (the Scrapbox
// export format, whose other fields are ignored).
type importLines []string

func (l *importLines) UnmarshalJSON(data []byte) error {
	var raw []json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	lines := make(importLines, len(raw))
	for i, entry := range raw {
		text, err := lineText(entry)
		if err != nil {
			return fmt.Errorf("lines[%d]: %w", i, err)
		}
		lines[i] = text
	}
	*l = lines
	return nil
}

// lineText reads one entry of "lines": a JSON string, or an object with a
// "text" string.
func lineText(entry json.RawMessage) (string, error) {
	var text string
	if err := json.Unmarshal(entry, &text); err == nil {
		return text, nil
	}
	var object struct {
		Text *string `json:"text"`
	}
	if err := json.Unmarshal(entry, &object); err != nil || object.Text == nil {
		return "", errors.New(`must be a string or an object with a "text" string`)
	}
	return *object.Text, nil
}

// importBatchSize is how many pages are committed in one database
// transaction. One transaction per page makes SQLite commit hundreds of
// thousands of times on a large export. A failure rolls back only the
// current batch, and re-running the import overwrites cards by title, so
// it is safe to retry.
const importBatchSize = 500

// ImportResult counts what an import did.
type ImportResult struct {
	Created     int
	Overwritten int
}

// pageSpan is the byte range of one page inside the import file. Only these
// ranges are kept in memory, never the pages themselves, so a file far larger
// than the available memory can be imported.
type pageSpan struct{ off, n int64 }

// checkPage trims and validates a decoded page.
func checkPage(page *importPage) error {
	// Trimmed like the editor's own title candidates (see
	// makeTitleCandidate in frontend/src/lib/models/card.ts).
	page.Title = strings.TrimSpace(page.Title)
	if page.Title == "" {
		return errors.New("no title")
	}
	return nil
}

// expectDelim reads the next token and fails unless it is the delimiter want.
func expectDelim(dec *json.Decoder, want json.Delim) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	if got, ok := tok.(json.Delim); !ok || got != want {
		return fmt.Errorf("expected %q, got %v", want, tok)
	}
	return nil
}

// indexPages streams through the file once, validating every page and
// recording where it is, so a bad file is rejected before anything is written.
// Each page is decoded and dropped right away.
func indexPages(r io.ReaderAt) ([]pageSpan, error) {
	dec := json.NewDecoder(io.NewSectionReader(r, 0, math.MaxInt64))
	if err := expectDelim(dec, '{'); err != nil {
		return nil, fmt.Errorf("invalid import file: %w", err)
	}

	var spans []pageSpan
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, fmt.Errorf("invalid import file: %w", err)
		}
		if key, _ := tok.(string); key != "pages" {
			var skipped json.RawMessage
			if err := dec.Decode(&skipped); err != nil {
				return nil, fmt.Errorf("invalid import file: %w", err)
			}
			continue
		}

		if err := expectDelim(dec, '['); err != nil {
			return nil, fmt.Errorf("invalid import file: pages: %w", err)
		}
		for dec.More() {
			// The range may start with the comma that follows the previous
			// page; readPage trims it.
			start := dec.InputOffset()
			var page importPage
			if err := dec.Decode(&page); err != nil {
				return nil, fmt.Errorf("invalid import file: pages[%d]: %w", len(spans), err)
			}
			if err := checkPage(&page); err != nil {
				return nil, fmt.Errorf("invalid import file: pages[%d] has %w", len(spans), err)
			}
			spans = append(spans, pageSpan{off: start, n: dec.InputOffset() - start})
		}
		if err := expectDelim(dec, ']'); err != nil {
			return nil, fmt.Errorf("invalid import file: pages: %w", err)
		}
	}
	return spans, nil
}

// readPage reads one page back from the file (see indexPages).
func readPage(r io.ReaderAt, span pageSpan) (importPage, error) {
	var page importPage
	data, err := io.ReadAll(io.NewSectionReader(r, span.off, span.n))
	if err != nil {
		return page, err
	}
	data = bytes.TrimLeft(data, " \t\r\n,")
	if err := json.Unmarshal(data, &page); err != nil {
		return page, err
	}
	return page, checkPage(&page)
}

// Import reads a JSON export from r and imports its pages into the pot named
// potName. A page whose title matches an existing card in that pot
// overwrites the card's body; any other page becomes a new card.
//
// The file is read twice, one page at a time (see indexPages and readPage),
// so memory use does not grow with the file's size.
//
// progress, when not nil, is called after each page with the number of pages
// done so far and the total.
func Import(app core.App, potName string, r io.ReaderAt, progress func(done, total int)) (ImportResult, error) {
	var result ImportResult

	spans, err := indexPages(r)
	if err != nil {
		return result, err
	}

	pot, err := app.FindFirstRecordByFilter("pots", "name = {:name}", dbx.Params{"name": potName})
	if errors.Is(err, sql.ErrNoRows) {
		return result, fmt.Errorf("pot %q not found", potName)
	}
	if err != nil {
		return result, fmt.Errorf("find pot %q: %w", potName, err)
	}

	// New cards get ever-higher positions and the card grid lists the
	// highest first, so importing in reverse keeps the file's order on
	// screen.
	for end := len(spans); end > 0; end -= importBatchSize {
		start := max(0, end-importBatchSize)
		err := app.RunInTransaction(func(tx core.App) error {
			// Everything inside the batch must use the transaction's app.
			for i := end - 1; i >= start; i-- {
				stop := stages.start("read page")
				page, err := readPage(r, spans[i])
				stop()
				if err != nil {
					return fmt.Errorf("read page %d: %w", i, err)
				}
				created, err := importImportedPage(tx, pot.Id, page)
				if err != nil {
					return fmt.Errorf("import page %q: %w", page.Title, err)
				}
				if created {
					result.Created++
				} else {
					result.Overwritten++
				}
				if progress != nil {
					progress(result.Created+result.Overwritten, len(spans))
				}
			}
			return nil
		})
		if err != nil {
			return result, err
		}
	}
	return result, nil
}

// importImportedPage creates or finds the card for page and replaces its body.
// It reports whether the card was newly created. A failure after the card
// record was created leaves a card without a note; re-running the import
// fills it in.
func importImportedPage(app core.App, pot string, page importPage) (created bool, err error) {
	text := pageText(page)
	stop := stages.start("find card")
	card, err := findCardByTitle(app, pot, page.Title)
	stop()
	if err != nil {
		return false, err
	}
	if card == nil {
		stop = stages.start("create card")
		card, err = createImportedCard(app, pot, page.Title, text)
		stop()
		if err != nil {
			return false, err
		}
		created = true
	}

	// Writes the note file and the data derived from it.
	stop = stages.start("replace content")
	err = persistNote(app, card.Id, text)
	stop()
	return created, err
}

// pageText joins a page's lines into the card's plain text. A page without
// lines still needs its title line.
func pageText(page importPage) string {
	if len(page.Lines) == 0 {
		return page.Title
	}
	return strings.Join(page.Lines, "\n")
}

// findCardByTitle returns the card in pot that title resolves to, or nil.
// Matching goes through titleLc, so it is case-insensitive like every
// other title lookup. Soft-deleted cards are ignored.
func findCardByTitle(app core.App, pot, title string) (*core.Record, error) {
	titleLc := slug.ToLowerKey(titleBase(TitleCandidate(title)))
	card, err := findLiveCardByTitleLc(app, pot, titleLc, "")
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return card, err
}

// createImportedCard saves a new "cards" record, mirroring createCardHandler.
// Its preview (description and image) is derived from text and stored right
// away, so syncDerived does not have to write the record a second time.
func createImportedCard(app core.App, pot, title, text string) (*core.Record, error) {
	// Cached: the lookup would otherwise re-read and re-parse the schema for
	// every imported page.
	collection, err := app.FindCachedCollectionByNameOrId("cards")
	if err != nil {
		return nil, fmt.Errorf("load cards collection: %w", err)
	}
	resolved, err := resolveTitle(app, pot, TitleCandidate(title), "")
	if err != nil {
		return nil, fmt.Errorf("resolve title: %w", err)
	}

	description, image, err := previewFields(app, text)
	if err != nil {
		return nil, fmt.Errorf("make preview: %w", err)
	}

	record := core.NewRecord(collection)
	record.Set("pot", pot)
	record.Set("title", string(resolved))
	record.Set("titleLc", slug.ToLowerKey(string(resolved)))
	record.Set("description", description)
	record.Set("image", image)
	if err := app.Save(record); err != nil {
		return nil, fmt.Errorf("save card: %w", err)
	}
	return record, nil
}
