package serve

import (
	"errors"
	"fmt"

	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpod/internal/wikilink"
)

// syncDerived brings every row derived from a card's saved text up to date:
// the preview (description and image), the wiki links and the search index.
// It decides nothing about when to run, and it returns errors instead of
// handling them.
//
// Every step always runs, so a failure of one does not leave the others stale.
func syncDerived(app core.App, room, text string) error {
	var errs []error
	stop := stages.start("derived: preview")
	err := updatePreview(app, room, text)
	stop()
	if err != nil {
		errs = append(errs, fmt.Errorf("update card preview: %w", err))
	}
	stop = stages.start("derived: links")
	err = wikilink.Sync(app, room, text)
	stop()
	if err != nil {
		errs = append(errs, fmt.Errorf("sync card links: %w", err))
	}
	stop = stages.start("derived: index")
	err = indexCard(app, room, text)
	stop()
	if err != nil {
		errs = append(errs, fmt.Errorf("index card: %w", err))
	}
	return errors.Join(errs...)
}
