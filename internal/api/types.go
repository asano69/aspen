// Package api defines the JSON shapes of the custom API routes.
// tygo turns this package into frontend/src/lib/api/generated.ts
// (see tygo.yaml), so the frontend types cannot drift from these.
package api

import "github.com/pocketbase/pocketbase/tools/types"

// CreateCardRequest is the body of POST /api/admin/cards.
type CreateCardRequest struct {
	Pot            string         `json:"pot"`
	TitleCandidate TitleCandidate `json:"titleCandidate" tstype:"TitleCandidate"`
}

// MoveCardsRequest is the body of POST /api/admin/cards/move. Each card is
// moved to the pot Pot, in the order of IDs.
type MoveCardsRequest struct {
	IDs []string `json:"ids"`
	Pot string   `json:"pot"`
}

// MoveCardsResponse reports how many cards were moved. Cards that are missing,
// deleted or already in the pot are skipped and not counted.
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

// SeenRequest is the body of POST /api/admin/cards/{id}/seen. Seen maps a Yjs
// client id to the next clock of that client the user has seen (a state
// vector as JSON).
type SeenRequest struct {
	Seen map[string]uint64 `json:"seen"`
}

// SeenResponse is the body of GET /api/admin/cards/{id}/seen. It is empty
// when the user has not seen the card yet.
type SeenResponse struct {
	Seen map[string]uint64 `json:"seen"`
}

// UploadAttachmentResponse is the body of POST /api/admin/attachments. URL is
// the attachment path ("@/<recordId>/<filename>") to write in image notation.
type UploadAttachmentResponse struct {
	URL string `json:"url"`
}

// SearchItem is one full-text search hit.
type SearchItem struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Preview []string `json:"preview"`
}

// SearchResponse is the body of GET /api/pages/{pot}/search/query.
type SearchResponse struct {
	Total int          `json:"total"`
	Items []SearchItem `json:"items"`
}
