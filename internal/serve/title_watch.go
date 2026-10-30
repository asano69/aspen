// title_watch.go resolves a card's title from the first line of its text. The
// open card (see rooms.go) calls resolve whenever that line changed, so the
// title can never desync from what the card actually holds, whichever editor
// made the change. It also announces a duplicate title and a rename to the
// clients.
package serve

import (
	"fmt"
	"log/slog"
	"slices"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/aspen/internal/slug"
)

// titleWatcher resolves titles and reports the result to the clients.
type titleWatcher struct {
	// notify reports a card's duplicate title to clients: mergeTarget is
	// the title it duplicates, or "" when it no longer does. Set once at
	// startup (see registerRoutes), before any room can be opened; nil
	// disables the report.
	notify func(cardID, mergeTarget string) error

	// notifyRename reports that the card was renamed away from oldTitle,
	// which other cards still link to (linkedFrom holds their titles).
	// Set once at startup, like notify; nil disables the report.
	notifyRename func(cardID, oldTitle string, linkedFrom []string) error
}

func newTitleWatcher() *titleWatcher { return &titleWatcher{} }

// titleWatcherInstance is the single watcher shared by every room.
var titleWatcherInstance = newTitleWatcher()

// resolve persists the title resolved from raw, retrying through the
// same numeric-suffix bump as cards.go's createCardHandler if a concurrent
// save takes the candidate title between resolveTitle's check and this save
// (TOCTOU) -- maxTitleRetries is defined once in cards.go and shared here.
func (w *titleWatcher) resolve(app core.App, room, raw string) {
	record, err := app.FindRecordById("cards", room)
	if err != nil {
		return // card deleted concurrently -- nothing to update
	}
	pod := record.GetString("pod")

	candidate := TitleCandidate(raw)
	for attempt := 0; attempt < maxTitleRetries; attempt++ {
		title, err := resolveTitle(app, pod, candidate, room)
		if err != nil {
			slog.Warn("resolve title", "room", room, "error", err)
			return
		}
		// An unchanged title is not written again: avoid a no-op write and
		// its "updated" bump.
		if record.GetString("title") != string(title) {
			// titleLc is what actually enforces uniqueness. The URL segment
			// is derived from title on demand (see internal/slug.FromTitle)
			// instead of being stored, and the note file follows titleLc (see
			// registerNoteHooks).
			previous := record.GetString("title")
			record.Set("title", string(title))
			record.Set("titleLc", slug.ToLowerKey(string(title)))
			if err := app.Save(record); err != nil {
				if attempt < maxTitleRetries-1 {
					candidate = TitleCandidate(fmt.Sprintf("%s_%d", raw, attempt+2))
					continue
				}
				slog.Warn("save resolved title", "room", room, "error", err)
				return
			}
			w.alertRename(app, pod, room, previous, string(title))
		}
		// Reported even when the title did not change: a card created from
		// a draft already holds its disambiguated title by now.
		w.alert(app, pod, room, TitleCandidate(raw), title)
		return
	}
}

// alert tells clients whether the card's header collided with another
// card's title (see findMergeTarget). A card that does not collide is
// reported too, with an empty target, so a shown alert is cleared. A failure
// is only logged: it must never affect the title itself.
func (w *titleWatcher) alert(app core.App, pod, room string, raw TitleCandidate, title CardTitle) {
	if w.notify == nil {
		return
	}
	target, err := findMergeTarget(app, pod, raw, title, room)
	if err != nil {
		slog.Warn("find merge target", "room", room, "error", err)
		return
	}
	if err := w.notify(room, string(target)); err != nil {
		slog.Warn("notify merge target", "room", room, "error", err)
	}
}

// alertRename tells clients that other cards still link to the title the card
// just left. Nothing is sent when no live card links to it, or when only the
// case changed (links match by titleLc, so they stay valid). A failure is only
// logged: it must never affect the title itself.
func (w *titleWatcher) alertRename(app core.App, pod, room, oldTitle, newTitle string) {
	if w.notifyRename == nil {
		return
	}
	oldLc := slug.ToLowerKey(oldTitle)
	if oldLc == slug.ToLowerKey(newTitle) {
		return
	}
	linking, err := linkingCards(app, pod, oldLc)
	if err != nil {
		slog.Warn("find linking cards", "room", room, "error", err)
		return
	}
	// A card that only links to itself has nothing to warn about.
	if !slices.ContainsFunc(linking, func(c linkingCard) bool { return c.ID != room }) {
		return
	}
	linkedFrom := make([]string, len(linking))
	for i, c := range linking {
		linkedFrom[i] = c.Title
	}
	if err := w.notifyRename(room, oldTitle, linkedFrom); err != nil {
		slog.Warn("notify rename", "room", room, "error", err)
	}
}

// linkingCard is a live card whose text links to a target.
type linkingCard struct {
	ID    string `db:"id"`
	Title string `db:"title"`
}

// linkingCards returns the live cards whose text links to the target (pod,
// titleLc), sorted by title. The renamed card is included: its own text may
// link to its old title too.
func linkingCards(app core.App, pod, titleLc string) ([]linkingCard, error) {
	cards := []linkingCard{}
	err := app.DB().NewQuery(`
		SELECT DISTINCT c.id, c.title FROM card_links l
		JOIN cards c ON c.id = l.source
		WHERE l.target_pod = {:pod} AND l.target_titleLc = {:titleLc}
			AND l.deleted = '' AND c.deleted = ''
		ORDER BY c.title`).
		Bind(dbx.Params{"pod": pod, "titleLc": titleLc}).
		All(&cards)
	return cards, err
}
