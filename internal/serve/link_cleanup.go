package serve

import (
	"log/slog"

	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/aspen/internal/wikilink"
)

// registerLinkCleanupHooks marks the links of a card as deleted the moment
// the card is soft-deleted (see wikilink.Sync), instead of waiting for its
// next text snapshot, which never comes for a deleted card.
func registerLinkCleanupHooks(app core.App) {
	app.OnRecordAfterUpdateSuccess("cards").BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if e.Record.GetDateTime("deleted").IsZero() {
			return nil
		}
		// A failure is only logged: it must never fail the delete itself.
		if err := wikilink.Sync(e.App, e.Record.Id, ""); err != nil {
			slog.Warn("clear links of deleted card", "card", e.Record.Id, "error", err)
		}
		return nil
	})
}
