// rooms.go holds the cards that are open for live editing. Each open card is
// one collab server (cmgo), which keeps the accepted change sets in memory and
// relays them to every connected editor. The card's content row (see
// contents.go) is written from it a moment after an edit, and once more when
// the last editor leaves, which is also when the room is dropped.
package serve

import (
	"log/slog"
	"maps"
	"net/http"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cmgo/authority"
	"github.com/asano69/cmgo/collab"

	"github.com/asano69/cardpod/internal/parser"
)

// settleDelay is how long after the first unsaved edit the room is saved.
// Edits made in between are saved together.
const settleDelay = time.Second

// liveRooms is the set of open cards of the running server. It is nil in the
// commands that run with the server stopped, which read the files directly.
var liveRooms *rooms

type rooms struct {
	app core.App

	mu   sync.Mutex
	open map[string]*room
}

func newRooms(app core.App) *rooms {
	return &rooms{app: app, open: map[string]*room{}}
}

// room is one open card. It is its own collab.Tracker: it learns about every
// accepted change and schedules a save.
type room struct {
	*collab.Server
	app  core.App
	id   string
	refs int // number of connected editors; guarded by rooms.mu

	scheduled atomic.Bool

	// saveMu serializes save and guards the two fields below. It is never
	// taken while the Document is locked (Track runs with it locked).
	saveMu  sync.Mutex
	saved   string // the text that was last stored
	lastRaw string // the first line that was last resolved into a title
}

// Track is called with the Document locked, so it only schedules the save.
func (r *room) Track([]authority.Change, []uint16, any, int64) {
	if r.scheduled.CompareAndSwap(false, true) {
		time.AfterFunc(settleDelay, r.settle)
	}
}

// Message is the extra message of the collab stream. There is none.
func (r *room) Message() []byte { return nil }

func (r *room) settle() {
	r.scheduled.Store(false)
	if err := r.save(); err != nil {
		slog.Warn("save card", "card", r.id, "error", err)
	}
}

// save resolves the title from the first line (which may rename the note
// file), then stores the text. It does nothing when nothing changed.
func (r *room) save() error {
	r.saveMu.Lock()
	defer r.saveMu.Unlock()

	text := r.Text()
	if raw := parser.Parse(text).Title(); raw != r.lastRaw {
		r.lastRaw = raw
		titleWatcherInstance.resolve(r.app, r.id, raw)
	}
	if text == r.saved {
		return nil
	}
	if err := persistNote(r.app, r.id, text); err != nil {
		return err
	}
	r.saved = text
	return nil
}

// get returns the open room of a card, or nil.
func (m *rooms) get(cardID string) *room {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.open[cardID]
}

// acquire returns the room of a card, opening it from its stored text if needed.
// Every acquire must be paired with a release.
func (m *rooms) acquire(cardID string) (*room, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if r, ok := m.open[cardID]; ok {
		r.refs++
		return r, nil
	}
	card, err := m.app.FindRecordById("cards", cardID)
	if err != nil {
		return nil, err
	}
	text, err := readNote(m.app, card)
	if err != nil {
		return nil, err
	}

	r := &room{
		app:     m.app,
		id:      cardID,
		refs:    1,
		saved:   text,
		lastRaw: parser.Parse(text).Title(),
	}
	r.Server = collab.New(collab.WithTracker(r))
	r.Replace(text)
	m.open[cardID] = r
	return r, nil
}

// release gives a room back. The last editor leaving saves and closes it.
func (m *rooms) release(r *room) {
	m.mu.Lock()
	defer m.mu.Unlock()

	r.refs--
	if r.refs > 0 {
		return
	}
	delete(m.open, r.id)
	if err := r.save(); err != nil {
		slog.Warn("save card", "card", r.id, "error", err)
	}
}

// flush saves every open room. Called when the server stops.
func (m *rooms) flush() {
	m.mu.Lock()
	open := slices.Collect(maps.Values(m.open))
	m.mu.Unlock()

	for _, r := range open {
		if err := r.save(); err != nil {
			slog.Warn("save card", "card", r.id, "error", err)
		}
	}
}

// ServeHTTP serves one editor of the card named by the {room} path value.
func (m *rooms) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	r, err := m.acquire(req.PathValue("room"))
	if err != nil {
		http.Error(w, "failed to open the card", http.StatusInternalServerError)
		return
	}
	defer m.release(r)
	r.ServeHTTP(w, req)
}

// loadCardText returns the current text of a card: the live copy when the card
// the open card, the stored text otherwise.
func loadCardText(app core.App, card *core.Record) (string, error) {
	if liveRooms != nil {
		if r := liveRooms.get(card.Id); r != nil {
			return r.Text(), nil
		}
	}
	return readNote(app, card)
}

// saveCardText replaces the text of a card. An open card changes for its
// editors too: they receive the difference like any other edit.
func saveCardText(app core.App, card *core.Record, text string) error {
	if liveRooms != nil {
		if r := liveRooms.get(card.Id); r != nil {
			r.Replace(text)
			return r.save()
		}
	}
	return persistNote(app, card.Id, text)
}
