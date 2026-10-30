// Package serve: types.go defines the string-based domain types shared
// across slug.go, cards.go, and ydoc.go, so a candidate string and a
// resolved title can never be passed to each other's functions by
// mistake even though both are just text underneath.
package serve

import "github.com/asano69/aspen/internal/api"

// TitleCandidate is raw, unresolved text extracted from a card's live
// document -- its header, or its first body line if the header is
// empty (see slugCandidatePlugin.ts on the frontend, and buildPreview
// in ydoc.go on the backend) -- before it has been normalized and
// disambiguated into a CardTitle.
//
// Defined in internal/api, which also feeds the frontend's generated request
// types; the alias keeps this package's code unchanged.
type TitleCandidate = api.TitleCandidate

// CardTitle is a card's display title, unique within a pod (see the
// "cards" collection's (pod, title) unique index). Resolved from a
// TitleCandidate via resolveTitle. A card's URL segment is no longer a
// separate stored field -- it's derived from CardTitle on demand (see
// internal/slug.FromTitle and its frontend mirror,
// frontend/src/lib/slugify.ts). There is no backend equivalent of the
// frontend's CardGridTitle -- the grid-specific title is a
// presentation concern the frontend derives on its own.
//
// Also defined in internal/api (see TitleCandidate above).
type CardTitle = api.CardTitle
