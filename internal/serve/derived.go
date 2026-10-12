package serve

import (
	"errors"
	"fmt"

	"github.com/asano69/cardpot/internal/wikilink"
)

// syncDerived brings every row derived from a card's saved text up to date:
// the preview (description and image) and the wiki links. It decides nothing
// about when to run, and it returns errors instead of handling them, so a
// caller inside a transaction can roll back while store() only logs.
//
// It works on p.app, so inside a transaction p must be built on the
// transaction's app. Both steps always run, so a failure of one does not leave
// the other stale.
func (p *ydocPersistence) syncDerived(room, text string) error {
	var errs []error
	if err := p.updatePreview(room, text); err != nil {
		errs = append(errs, fmt.Errorf("update card preview: %w", err))
	}
	if err := wikilink.Sync(p.app, room, text); err != nil {
		errs = append(errs, fmt.Errorf("sync card links: %w", err))
	}
	if err := indexCard(p.app, room, text); err != nil {
		errs = append(errs, fmt.Errorf("index card: %w", err))
	}
	return errors.Join(errs...)
}
