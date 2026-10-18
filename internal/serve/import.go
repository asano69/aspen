// import.go implements "cardpot import": it loads pages from a JSON export
// into one pot. A card body is never written to the database directly --
// it is committed as a Yjs update through ygo's persistence adapter
// (ydocPersistence.StoreUpdate), the same path a live editing session
// uses. Only the card record itself (pot, title, position) is created
// the way createCardHandler creates it.
//
// The command opens the data directory in its own process, so run it while
// the server is stopped: a room the running server already holds in memory
// would not see the imported content.
package serve

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/reearth/ygo/crdt"
	yjsws "github.com/reearth/ygo/provider/websocket"

	"github.com/asano69/cardpot/internal/slug"
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

	// StoreUpdate reads the package-level yjsServer, so one has to exist even
	// though this process never serves a connection. No room is ever loaded
	// into it, which is why the derived card data is synced explicitly below.
	persistence := &ydocPersistence{app: app}
	yjsServer = yjsws.NewServerWithPersistence(persistence)
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := yjsServer.Shutdown(ctx); err != nil {
			slog.Warn("yjs server shutdown", "error", err)
		}
	}()

	// New cards get ever-higher positions and the card grid lists the
	// highest first, so importing in reverse keeps the file's order on
	// screen.
	for end := len(spans); end > 0; end -= importBatchSize {
		start := max(0, end-importBatchSize)
		err := app.RunInTransaction(func(tx core.App) error {
			// Everything inside the batch must use the transaction's app.
			batch := &ydocPersistence{app: tx}
			for i := end - 1; i >= start; i-- {
				page, err := readPage(r, spans[i])
				if err != nil {
					return fmt.Errorf("read page %d: %w", i, err)
				}
				created, err := importImportedPage(tx, batch, pot.Id, page)
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

// importPage creates or finds the card for page and replaces its body.
// It reports whether the card was newly created. A failure after the card
// record was created leaves an empty card behind; re-running the import
// fills it in.
func importImportedPage(app core.App, p *ydocPersistence, pot string, page importPage) (created bool, err error) {
	card, err := findCardByTitle(app, pot, page.Title)
	if err != nil {
		return false, err
	}
	if card == nil {
		card, err = createImportedCard(app, pot, page.Title)
		if err != nil {
			return false, err
		}
		created = true
	}

	text := pageText(page)
	if err := p.replaceContent(card.Id, text); err != nil {
		return created, err
	}

	// Same derived data ydocPersistence.store keeps in sync for a live room.
	return created, p.syncDerived(card.Id, text)
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

// createImportedCard saves a new, empty "cards" record, mirroring
// createCardHandler.
func createImportedCard(app core.App, pot, title string) (*core.Record, error) {
	collection, err := app.FindCollectionByNameOrId("cards")
	if err != nil {
		return nil, fmt.Errorf("load cards collection: %w", err)
	}
	resolved, err := resolveTitle(app, pot, TitleCandidate(title), "")
	if err != nil {
		return nil, fmt.Errorf("resolve title: %w", err)
	}

	record := core.NewRecord(collection)
	record.Set("pot", pot)
	record.Set("title", string(resolved))
	record.Set("titleLc", slug.ToLowerKey(string(resolved)))
	if err := app.Save(record); err != nil {
		return nil, fmt.Errorf("save card: %w", err)
	}
	return record, nil
}

// replaceContent makes the "content" text of room equal to text by
// committing one Yjs update through StoreUpdate. The room's stored history
// is replayed first, so the old text is deleted (not orphaned) and any
// editor that later loads the room sees a normal edit.
//
// The stored update is the document's full state after the edit. Yjs
// updates merge idempotently, so LoadDoc replaying it on top of the
// earlier increments yields exactly this document.
func (p *ydocPersistence) replaceContent(room, text string) error {
	stored, err := p.LoadDoc(room)
	if err != nil {
		return fmt.Errorf("load card document: %w", err)
	}
	doc := crdt.New()
	if len(stored) > 0 {
		if err := doc.ApplyUpdate(stored); err != nil {
			return fmt.Errorf("apply stored updates: %w", err)
		}
	}

	content := doc.GetText("content")
	old := content.ToString()
	if old == text {
		return nil // already up to date -- don't grow the update log
	}

	// Yjs text indexes and lengths count UTF-16 code units.
	oldLen := len(utf16.Encode([]rune(old)))
	doc.Transact(func(txn *crdt.Transaction) {
		if oldLen > 0 {
			content.Delete(txn, 0, oldLen)
		}
		if text != "" {
			content.Insert(txn, 0, text, nil)
		}
	})

	if err := p.StoreUpdate(room, doc.EncodeStateAsUpdate()); err != nil {
		return fmt.Errorf("store card document: %w", err)
	}
	return nil
}
