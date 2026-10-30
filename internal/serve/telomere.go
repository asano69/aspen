// telomere.go serves the data of the telomere, the bar left of each line of
// the note editor: who edited a line and when (the signed lines of
// card_contents, see contents.go), and whether the line is unread.
//
// The lines reach an editor through the "lines" message of the collab stream
// (see room.Message in rooms.go), so they follow every accepted edit. The
// route below only answers what the stream cannot: who the requesting user is
// and when they last left the card's room (the "left" time of room_events, see
// room_events.go). A line is unread when someone else edited it after that
// time; the client works that out.
package serve

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/aspen/internal/api"
	"github.com/asano69/aspen/internal/lineid"
)

// linesMessage is the "lines" message of the collab stream: the metadata of
// every line of the card, in order.
type linesMessage struct {
	Type  string             `json:"type"`
	Lines []api.TelomereLine `json:"lines"`
}

// telomereHandler serves GET /api/admin/cards/{id}/telomere.
func telomereHandler(e *core.RequestEvent) error {
	left, err := lastLeft(e.App, e.Auth.Id, e.Request.PathValue("id"))
	if err != nil {
		return e.InternalServerError("read when the user left the card", err)
	}
	return e.JSON(http.StatusOK, api.TelomereResponse{Me: e.Auth.Email(), Left: left})
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

// telomereLines keeps what the editor shows of each line. The signature and
// the hash stay on the server. A card without lines gives an empty list, not
// nil (which would encode as null).
func telomereLines(lines []lineid.Line) []api.TelomereLine {
	out := make([]api.TelomereLine, len(lines))
	for i, l := range lines {
		out[i] = api.TelomereLine{ID: l.ID, Updated: l.Updated, User: l.User}
	}
	return out
}
