// notes.go keeps the text of every card in a plain file:
//
//	<data dir>/notes/<pot id>/<escaped titleLc>.csn
//
// The file is the only stored copy of the text: no editing history is kept.
// While a card is open, its live copy is a collab server held by rooms.go,
// which writes the file a moment after each edit.
//
// A file name follows the card's titleLc, which is unique among the live cards
// of a pot. The file of a deleted card is moved to the trash, so that its name
// can be taken by another card (see registerNoteHooks).
//
// Known limit: a very long title (240 characters of Japanese is 720 bytes)
// exceeds the 255 bytes a file name may have, and its note cannot be written.
package serve

import (
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cmgo/persistence"
)

const (
	noteExt  = ".csn"
	trashDir = ".trash"
)

func notesDir(app core.App) string { return filepath.Join(app.DataDir(), "notes") }

func notePath(app core.App, pot, titleLc string) string {
	return filepath.Join(notesDir(app), pot, fileNameEscaper.Replace(titleLc)+noteExt)
}

func cardNotePath(app core.App, card *core.Record) string {
	return notePath(app, card.GetString("pot"), card.GetString("titleLc"))
}

// readNote returns the stored text of card, or "" when it has no file yet.
func readNote(app core.App, card *core.Record) (string, error) {
	data, err := os.ReadFile(cardNotePath(app, card))
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read the note of card %s: %w", card.Id, err)
	}
	return string(data), nil
}

func writeNote(app core.App, card *core.Record, text string) error {
	path := cardNotePath(app, card)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create the folder of the note of card %s: %w", card.Id, err)
	}
	return persistence.WriteAtomic(path, []byte(text))
}

// persistNote stores text as the note of a card and brings the data derived
// from it (preview, links, search index) up to date. A card that no longer
// exists or is deleted is ignored.
func persistNote(app core.App, cardID, text string) error {
	card, err := app.FindRecordById("cards", cardID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if !card.GetDateTime("deleted").IsZero() {
		return nil
	}
	if err := writeNote(app, card, text); err != nil {
		return err
	}
	return syncDerived(app, cardID, text)
}

// renameNote moves the file of a card whose titleLc changed. When the new file
// was already written (a save raced the rename), it is newer, so the old one
// is just dropped.
func renameNote(app core.App, pot, oldLc, newLc string) {
	if oldLc == newLc {
		return
	}
	from, to := notePath(app, pot, oldLc), notePath(app, pot, newLc)
	if _, err := os.Stat(to); err == nil {
		_ = os.Remove(from)
		return
	}
	if err := os.Rename(from, to); err != nil && !errors.Is(err, fs.ErrNotExist) {
		slog.Warn("rename note", "from", from, "to", to, "error", err)
	}
}

// trashNote moves the file of a deleted card out of the way.
func trashNote(app core.App, pot, titleLc, cardID string) {
	from := notePath(app, pot, titleLc)
	to := filepath.Join(notesDir(app), pot, trashDir, cardID+noteExt)
	if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
		slog.Warn("create note trash", "error", err)
		return
	}
	if err := os.Rename(from, to); err != nil && !errors.Is(err, fs.ErrNotExist) {
		slog.Warn("trash note", "from", from, "error", err)
	}
}

// registerNoteHooks keeps the files in step with their cards: a file follows
// its card's titleLc, and the file of a card that was just deleted is trashed.
func registerNoteHooks(app core.App) {
	app.OnRecordUpdate("cards").BindFunc(func(e *core.RecordEvent) error {
		before := e.Record.Original()
		pot, oldLc := before.GetString("pot"), before.GetString("titleLc")
		wasLive := before.GetDateTime("deleted").IsZero()

		if err := e.Next(); err != nil {
			return err
		}
		switch {
		case wasLive && !e.Record.GetDateTime("deleted").IsZero():
			trashNote(e.App, pot, oldLc, e.Record.Id)
		case e.Record.GetDateTime("deleted").IsZero():
			renameNote(e.App, pot, oldLc, e.Record.GetString("titleLc"))
		}
		return nil
	})
}
