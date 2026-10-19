// ydoc.go persists each card's Yjs body content as an append-only log
// of updates in the "card_ydocs" collection, one record per increment
// (see the "card" relation field there), following the same pattern
// as y-leveldb and other standard Yjs persistence adapters. Each
// increment is stored as a base64 string in the "payload" text field
// rather than a file, since a single increment is typically only a
// few hundred bytes -- too small for a file field's filesystem
// round-trip and orphan-cleanup cost to be worth it.
// ydocPersistence plugs into ygo's PersistenceAdapter (LoadDoc/
// StoreUpdate) and its context-aware extension
// PersistenceAdapterContext (StoreUpdateContext) so that log seeds a
// room on its first connection and grows with the room's live edits.
//
// Debouncing writes, isolating slow saves to one room at a time, and
// flushing a room before it is evicted or the server shuts down are
// all handled by ygo itself:
//   - Server.PersistCoalesceWindow / PersistCoalesceMaxWait (defaults:
//     2s / 10s) already coalesce StoreUpdate calls per room, so this
//     file doesn't need its own dirty-tracking or ticker.
//   - the last peer disconnecting from a room triggers a durable
//     flush-before-evict on ygo's side.
//   - Server.Shutdown drains any buffered writes, calling
//     StoreUpdateContext with a context cancelled at shutdown so an
//     in-flight save can abort instead of blocking indefinitely.
//
// Since the log would otherwise grow forever, compactIfNeeded merges
// it back down to a single record once it passes compactionThreshold.
package serve

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/reearth/ygo/crdt"
	yjsws "github.com/reearth/ygo/provider/websocket"

	"github.com/asano69/cardpot/internal/parser"
)

// compactionThreshold is how many stored increments a room's update
// log can hold before compactIfNeeded merges them into one record.
// Keeps LoadDoc from replaying an ever-growing history on every
// reconnect.
const compactionThreshold = 200

var initYjsServerOnce sync.Once

// initYjsServer creates the shared yjsServer (see handler.go) wired to
// a PocketBase-backed persistence adapter, registers the card-delete
// cleanup hook, and hooks graceful shutdown so ygo's own Shutdown can
// drain pending writes before the process exits. Safe to call more
// than once; only the first call has any effect.
func initYjsServer(app core.App) {
	initYjsServerOnce.Do(func() {
		yjsServer = yjsws.NewServerWithPersistence(&ydocPersistence{app: app})

		// Observes the room's live "content" YText directly, independent
		// of StoreUpdate's persistence coalescing
		// (Server.PersistCoalesceWindow / PersistCoalesceMaxWait). This
		// fires synchronously on every applied Yjs transaction -- i.e.
		// essentially the instant a peer types -- so it's useful for
		// low-latency debug logging of line 0 (the title candidate),
		// unlike the periodic snapshot logging in store() below, which
		// only runs once the debounced persistence flush happens.
		// Registered once per room, right after the room's crdt.Doc is
		// constructed and before any peer can touch it (see ygo's
		// OnLoadDocument doc comment).
		// Debounced server-side title resolution (see title_watch.go):
		// this now supersedes the old debug-only line0 logging that
		// used to live here.
		yjsServer.OnLoadDocument = func(_ context.Context, room string, doc *crdt.Doc) error {
			titleWatcherInstance.observe(app, room, doc)
			return nil
		}

		// Deleting a card should stop tracking (and drop) its live
		// room too, so a deleted card doesn't linger in memory here
		// once it no longer exists in PocketBase.
		app.OnRecordAfterDeleteSuccess("cards").BindFunc(func(e *core.RecordEvent) error {
			forgetRoom(e.Record.Id)
			return e.Next()
		})

		// TODO: verify core.TerminateEvent's exact shape against the
		// vendored PocketBase version (`go doc
		// github.com/pocketbase/pocketbase/core App.OnTerminate`)
		// before relying on this in production.
		app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := yjsServer.Shutdown(ctx); err != nil {
				slog.Warn("yjs server shutdown", "error", err)
			}
			return e.Next()
		})
	})
}

// ydocPersistence adapts the "ydoc_updates" collection to ygo's
// PersistenceAdapter and PersistenceAdapterContext interfaces. The
// room name is always a "cards" record id (see NoteEditor.tsx), stored
// on each ydoc_updates record via its "card" relation field.
type ydocPersistence struct {
	app core.App
}

// findUpdateRecords returns every stored increment for room, oldest
// first, so callers can replay or compact them in the order they were
// written.
func (p *ydocPersistence) findUpdateRecords(room string) ([]*core.Record, error) {
	return p.app.FindRecordsByFilter(
		"card_ydocs",
		"card = {:card}",
		"created",
		0, 0,
		dbx.Params{"card": room},
	)
}

// loadUpdates reads the raw update bytes off every stored increment
// for room, oldest first. Each increment is a base64 string in the
// "payload" text field, so no filesystem access is needed anymore.
func (p *ydocPersistence) loadUpdates(room string) ([][]byte, error) {
	records, err := p.findUpdateRecords(room)
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, nil
	}

	updates := make([][]byte, 0, len(records))
	for _, record := range records {
		encoded := record.GetString("payload")
		if encoded == "" {
			continue
		}
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, fmt.Errorf("decode payload for record %s: %w", record.Id, err)
		}
		updates = append(updates, data)
	}
	return updates, nil
}

// LoadDoc seeds a room by replaying every stored increment for the
// matching card, oldest first, the first time a peer connects to it.
// No stored increments is not an error -- it just means the room
// starts empty (e.g. a brand-new card).
func (p *ydocPersistence) LoadDoc(room string) ([]byte, error) {
	updates, err := p.loadUpdates(room)
	if err != nil {
		return nil, err
	}
	switch len(updates) {
	case 0:
		return nil, nil
	case 1:
		return updates[0], nil
	default:
		return mergeUpdates(updates)
	}
}

// mergeUpdates combines multiple standalone Yjs updates into the
// single update that applying all of them, in order, would produce.
// Only needed here for LoadDoc, when a room's history hasn't been
// compacted down to one record yet.
func mergeUpdates(updates [][]byte) ([]byte, error) {
	doc := crdt.New()
	for _, update := range updates {
		if err := doc.ApplyUpdate(update); err != nil {
			return nil, err
		}
	}
	return doc.EncodeStateAsUpdate(), nil
}

// StoreUpdate is called by ygo's per-room persistence worker, already
// debounced by Server.PersistCoalesceWindow/PersistCoalesceMaxWait
// (coalesced every 2s, forced at least every 10s by default). Unlike
// the old full-snapshot approach, the update bytes ygo hands us are
// saved as-is -- the room's document is never re-encoded on a normal
// save, so a write's cost is proportional to the size of the edit
// rather than the size of the whole document.
func (p *ydocPersistence) StoreUpdate(room string, update []byte) error {
	return p.store(context.Background(), room, update)
}

// StoreUpdateContext is the shutdown-aware variant ygo prefers when
// available (see PersistenceAdapterContext): ctx is cancelled once
// Server.Shutdown begins, so a save still starting at that point can
// abort instead of blocking shutdown.
func (p *ydocPersistence) StoreUpdateContext(ctx context.Context, room string, update []byte) error {
	return p.store(ctx, room, update)
}

// store appends update as a new increment for room, then compacts the
// room's history once it grows past compactionThreshold.
func (p *ydocPersistence) store(ctx context.Context, room string, update []byte) error {
	if len(update) == 0 {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return err // shutting down -- abort before touching the DB
	}

	collection, err := p.app.FindCachedCollectionByNameOrId("card_ydocs")
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Set("card", room)
	record.Set("payload", base64.StdEncoding.EncodeToString(update))
	if err := p.app.Save(record); err != nil {
		return err
	}

	// The card's "description" field is derived from the same live
	// text snapshot, so it's read once here. GetText(...).String() is
	// called directly, not from inside a doc.Transact callback:
	// reading text content takes the document's read lock internally,
	// which would deadlock under Transact's write lock. Calling it
	// here, right after our own StoreUpdate has returned, matches how
	// compactIfNeeded already calls doc.EncodeStateAsUpdate() directly
	// on the same live doc.
	if doc := yjsServer.GetDoc(room); doc != nil {
		text := doc.GetText("content").ToString()
		slog.Debug("card text", "room", room, "text", text)

		// "title" is resolved explicitly from the client's candidate
		// text via the /api/admin/cards routes (see cards.go and
		// slug.go's resolveSlugAndTitle), so it doesn't depend on
		// this periodic snapshot.
		// The preview and the wiki links (the "card_links" collection) are
		// derived from the same snapshot. A failure is only logged: it must
		// never block persisting the document itself.
		if err := p.syncDerived(room, text); err != nil {
			slog.Warn("sync derived data", "room", room, "error", err)
		}
	}

	return p.compactIfNeeded(room)
}

// updatePreview refreshes a card's derived description and image fields from text --
// the room's live "content" YText, already read once by the caller
// (see store). "title" and "slug" are resolved elsewhere (see
// slug.go's resolveSlugAndTitle), not here.
func (p *ydocPersistence) updatePreview(room, text string) error {
	record, err := p.app.FindRecordById("cards", room)
	if err != nil {
		return nil // card may have been deleted concurrently -- skip
	}

	description, image, err := previewFields(p.app, text)
	if err != nil {
		return err
	}
	// GetString on a JSON field returns its raw JSON text, so it is compared
	// with the JSON text that is about to be stored.
	if record.GetString("description") == string(description) && record.GetString("image") == image {
		return nil // unchanged -- avoid a no-op write and its "updated" bump
	}
	record.Set("description", description)
	record.Set("image", image)
	return p.app.Save(record)
}

// previewFields computes the values of a card's derived "description" and
// "image" fields from its text. It is shared by updatePreview and by the
// importer, which stores them together with the new card record.
func previewFields(app core.App, text string) (types.JSONRaw, string, error) {
	description, err := json.Marshal(descriptionLines(text))
	if err != nil {
		return nil, "", err
	}
	return types.JSONRaw(description), thumbnailSrc(app, parser.Parse(text)), nil
}

// descriptionLines is the value of a card's "description" JSON field: the
// preview text split into lines. An empty preview is an empty list (never
// nil, which would be stored as JSON null).
func descriptionLines(text string) []string {
	preview := buildPreview(text)
	if preview == "" {
		return []string{}
	}
	return strings.Split(preview, "\n")
}

// descriptionMaxRunes caps how much text buildPreview keeps, counted
// in runes (not bytes) so a card written in Japanese isn't cut
// mid-character.
const descriptionMaxRunes = 120

// buildPreview turns a card's full plain-text content into a short
// description: every non-blank line after the first (the title),
// joined by a newline and cut to descriptionMaxRunes runes. The
// title itself is excluded here since it's resolved separately (see
// slug.go's resolveSlugAndTitle).
//
// A code: block is shown without its declaration line, and each of its
// body lines is wrapped in backticks. The rewrite happens in place, so
// the block keeps its position among the other lines.
func buildPreview(text string) string {
	lines := strings.Split(text, "\n")
	for _, node := range parser.Parse(text).Nodes {
		if node.Kind != parser.KindCodeBlock {
			continue
		}
		lines[node.StartLine] = "" // the declaration is dropped
		for i, body := range node.Body {
			lines[node.StartLine+1+i] = quoteCodeLine(body)
		}
	}
	if len(lines) > 0 {
		lines = lines[1:] // drop the title line
	}

	var body []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			body = append(body, trimmed)
		}
	}
	return truncateRunes(strings.Join(body, "\n"), descriptionMaxRunes)
}

// quoteCodeLine wraps one code line in backticks. A line with nothing but
// whitespace becomes empty, so it is skipped like any other blank line.
func quoteCodeLine(line string) string {
	if strings.TrimSpace(line) == "" {
		return ""
	}
	return "`" + line + "`"
}

// truncateRunes cuts s to at most max runes (not bytes), so a card
// written in Japanese isn't cut mid-character.
func truncateRunes(s string, max int) string {
	runes := []rune(s)
	if len(runes) > max {
		runes = runes[:max]
	}
	return string(runes)
}

// compactIfNeeded merges every stored increment for room into a single
// record once their count passes compactionThreshold, so LoadDoc never
// has to replay an unbounded history for a long-lived room. Only
// called right after StoreUpdate, so the room's live doc -- the one
// being edited -- is guaranteed to exist and already holds every
// increment merged together; re-encoding it is equivalent to merging
// every record here, with no separate merge step needed.
func (p *ydocPersistence) compactIfNeeded(room string) error {
	records, err := p.findUpdateRecords(room)
	if err != nil {
		return err
	}
	if len(records) <= compactionThreshold {
		return nil
	}

	doc := yjsServer.GetDoc(room)
	if doc == nil {
		return nil // room isn't loaded right now -- compact next time instead
	}

	collection, err := p.app.FindCollectionByNameOrId("card_ydocs")
	if err != nil {
		return err
	}
	compacted := core.NewRecord(collection)
	compacted.Set("card", room)
	compacted.Set("payload", base64.StdEncoding.EncodeToString(doc.EncodeStateAsUpdate()))
	if err := p.app.Save(compacted); err != nil {
		return err
	}

	for _, record := range records {
		if err := p.app.Delete(record); err != nil {
			return err
		}
	}
	return nil
}

// forgetRoom closes room's live Yjs room, if any. Called when the
// matching card is deleted; its ydoc_updates records are expected to
// cascade-delete via the "card" relation field's cascadeDelete option,
// so only the in-memory room needs cleaning up here.
func forgetRoom(room string) {
	titleWatcherInstance.forget(room)
	if yjsServer != nil {
		_ = yjsServer.CloseRoom(room, true)
	}
}
