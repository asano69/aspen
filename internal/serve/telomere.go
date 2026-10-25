// telomere.go serves the data of the telomere, the bar left of each line of
// the note editor: who edited a line and when (the signed lines of
// card_contents, see contents.go), and whether the line is unread. A line is
// unread when someone else edited it after the requesting user last left the
// card's room (the "left" time of room_events, see room_events.go).
package serve

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpod/internal/api"
	"github.com/asano69/cardpod/internal/lineid"
)

// telomereHandler serves GET /api/admin/cards/{id}/telomere.
func telomereHandler(e *core.RequestEvent) error {
	card, err := e.App.FindRecordById("cards", e.Request.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		return e.NotFoundError("card not found", nil)
	}
	if err != nil {
		return e.InternalServerError("find card", err)
	}

	lines, err := currentLines(e.App, card)
	if err != nil {
		return e.InternalServerError("read the lines of the card", err)
	}
	left, err := lastLeft(e.App, e.Auth.Id, card.Id)
	if err != nil {
		return e.InternalServerError("read when the user left the card", err)
	}
	return e.JSON(http.StatusOK, api.TelomereResponse{
		Lines: telomereLines(lines, e.Auth.Email(), left),
	})
}

// currentLines returns the lines of a card: the live ones while the card is
// open, the stored ones otherwise.
func currentLines(app core.App, card *core.Record) ([]lineid.Line, error) {
	if liveRooms != nil {
		if r := liveRooms.get(card.Id); r != nil {
			_, lines := r.snapshot()
			return lines, nil
		}
	}
	return readLines(app, card)
}

// lastLeft returns the Unix time the user last left the card's room, or 0
// when there is no record of it.
func lastLeft(app core.App, userID, cardID string) (int64, error) {
	record, err := app.FindFirstRecordByFilter(
		roomEventsCollection, "card = {:card} && user = {:user}",
		dbx.Params{"card": cardID, "user": userID},
	)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	left := record.GetDateTime("left")
	if left.IsZero() {
		return 0, nil
	}
	return left.Time().Unix(), nil
}

// telomereLines turns stored lines into the response rows. A line without a
// known author is never unread, and neither is a line the user edited.
func telomereLines(lines []lineid.Line, me string, left int64) []api.TelomereLine {
	out := make([]api.TelomereLine, len(lines))
	for i, l := range lines {
		out[i] = api.TelomereLine{
			Updated: l.Updated,
			User:    l.User,
			Unread:  l.User != "" && l.User != me && l.Updated > left,
		}
	}
	return out
}
