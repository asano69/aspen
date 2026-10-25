package api

// These named types give the Go side its own protection against mixing up a
// raw header with a resolved title. They are deliberately kept in this file,
// which tygo skips (see tygo.yaml): on the frontend the same names are branded
// types from lib/models/card.ts, pulled in with the `tstype` tags in types.go.

// TitleCandidate is raw, unresolved text extracted from a card's live
// document, before it has been normalized into a CardTitle.
type TitleCandidate string

// CardTitle is a card's display title, unique within a pod.
type CardTitle string
