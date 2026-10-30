// Package api defines the JSON shapes of the custom API routes.
// tygo turns this package into frontend/src/lib/api/generated.ts
// (see tygo.yaml), so the frontend types cannot drift from these.
package api

import "github.com/pocketbase/pocketbase/tools/types"

// CreateCardRequest is the body of POST /api/admin/cards.
type CreateCardRequest struct {
	Pod            string         `json:"pod"`
	TitleCandidate TitleCandidate `json:"titleCandidate" tstype:"TitleCandidate"`
}

// MoveCardsRequest is the body of POST /api/admin/cards/move. Each card is
// moved to the pod Pod, in the order of IDs.
type MoveCardsRequest struct {
	IDs []string `json:"ids"`
	Pod string   `json:"pod"`
}

// MoveCardsResponse reports how many cards were moved. Cards that are missing,
// deleted or already in the pod are skipped and not counted.
type MoveCardsResponse struct {
	Moved int `json:"moved"`
}

// LinkedCard is one card entry in the links1hop / links2hop responses.
type LinkedCard struct {
	ID      string    `json:"id"`
	Title   CardTitle `json:"title" tstype:"CardTitle"`
	TitleLc string    `json:"titleLc"`
	// Raw JSON as stored in the "description" field (a list of lines).
	Description   types.JSONRaw `json:"description" tstype:"string[] | null"`
	Image         string        `json:"image"`
	// 0 for an unpinned card; pinned cards are listed by descending Pin.
	Pin           float64       `json:"pin"`
	TargetTitleLc []string      `json:"target_titleLc" tstype:"string[]"`
}

// Link2HopCard is one row of the links2hop response: a card that links to
// the shared target (ViaTitle), which the open card links to as well. A card
// sharing several targets appears only once, under the first of them in the
// open card. Rows of the same target are adjacent, in the order the targets
// appear in the open card.
type Link2HopCard struct {
	LinkedCard `tstype:",extends"`
	ViaTitle   string `json:"via_title"`
	ViaTitleLc string `json:"via_titleLc"`
}

// RenameLinksRequest is the body of POST /api/admin/cards/{id}/rename-links.
// The new title is not sent: the card's current title is used.
type RenameLinksRequest struct {
	OldTitle string `json:"oldTitle"`
}

// RenameLinksResponse reports how many cards had their links rewritten.
type RenameLinksResponse struct {
	Updated int `json:"updated"`
}


// UploadAttachmentResponse is the body of POST /api/admin/attachments. URL is
// the attachment path ("@/files/<ULID><ext>") to write in image notation.
type UploadAttachmentResponse struct {
	URL string `json:"url"`
}

// SearchItem is one full-text search hit.
type SearchItem struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Preview []string `json:"preview"`
}

// SearchResponse is the body of GET /api/pages/{pod}/search/query.
type SearchResponse struct {
	Total int          `json:"total"`
	Items []SearchItem `json:"items"`
}

// TelomereLine is the edit record of one line of a card, as the "lines"
// message of the collab stream carries it (see internal/serve/telomere.go).
type TelomereLine struct {
	// ID of the line (see internal/lineid).
	ID string `json:"id"`
	// Unix time of the last edit of the line.
	Updated int64 `json:"updated"`
	// Email address of the user who made that edit; empty if unknown.
	User string `json:"user"`
}

// TelomereResponse is the body of GET /api/admin/cards/{id}/telomere: what
// only the requesting user knows. With the lines, it tells which lines are
// unread.
type TelomereResponse struct {
	// Email address of the requesting user, as it appears in TelomereLine.User.
	Me string `json:"me"`
	// Unix time the user last left the card's room; 0 if there is no record.
	Left int64 `json:"left"`
}
