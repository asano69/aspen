// Package search defines an engine-agnostic full-text search interface.
// Swapping Bleve for Elasticsearch or Meilisearch only requires a new
// Engine implementation; callers never import an engine package.
package search

// Doc is the indexable form of a card.
type Doc struct {
	ID    string // card id
	PotID string // owning pot id, used to scope queries
	Title string
	Body  string
}

// Query is a search request scoped to one pot.
type Query struct {
	Text   string
	PotID  string
	Limit  int
	Offset int
}

// Result holds ranked card ids. Card data is loaded from PocketBase, so
// engines only need to store what they search on.
type Result struct {
	Total uint64
	IDs   []string
}

// Engine is the interface every search backend implements.
type Engine interface {
	Index(doc Doc) error
	Delete(id string) error
	Search(q Query) (Result, error)
	Close() error
}
