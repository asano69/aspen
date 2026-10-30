package search

import (
	"errors"
	"fmt"

	"github.com/blevesearch/bleve/v2"
	"github.com/blevesearch/bleve/v2/analysis/analyzer/custom"
	"github.com/blevesearch/bleve/v2/analysis/analyzer/keyword"
	"github.com/blevesearch/bleve/v2/analysis/token/lowercase"
	"github.com/blevesearch/bleve/v2/analysis/tokenizer/unicode"
	"github.com/blevesearch/bleve/v2/mapping"
	"github.com/blevesearch/bleve/v2/search/query"
)

const analyzerName = "aspen_unicode"

// Bleve is an Engine backed by an on-disk Bleve index, stored separately
// from the PocketBase SQLite database.
type Bleve struct {
	idx bleve.Index
}

// bleveDoc is the shape stored in the index.
type bleveDoc struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	Pod   string `json:"pod"`
}

// OpenBleve opens the index at dir, creating it if it does not exist.
func OpenBleve(dir string) (*Bleve, error) {
	idx, err := bleve.Open(dir)
	if errors.Is(err, bleve.ErrorIndexPathDoesNotExist) {
		idx, err = bleve.New(dir, newMapping())
	}
	if err != nil {
		return nil, fmt.Errorf("open search index %q: %w", dir, err)
	}
	return &Bleve{idx: idx}, nil
}

// newMapping uses the language-agnostic Unicode tokenizer plus lowercasing.
func newMapping() mapping.IndexMapping {
	m := bleve.NewIndexMapping()
	err := m.AddCustomAnalyzer(analyzerName, map[string]any{
		"type":          custom.Name,
		"tokenizer":     unicode.Name,
		"token_filters": []string{lowercase.Name},
	})
	if err != nil {
		panic(err) // static configuration; cannot fail at runtime
	}

	text := bleve.NewTextFieldMapping()
	text.Analyzer = analyzerName
	text.Store = false

	pod := bleve.NewTextFieldMapping()
	pod.Analyzer = keyword.Name
	pod.Store = false

	doc := bleve.NewDocumentMapping()
	doc.Dynamic = false
	doc.AddFieldMappingsAt("title", text)
	doc.AddFieldMappingsAt("body", text)
	doc.AddFieldMappingsAt("pod", pod)
	m.DefaultMapping = doc
	return m
}

func (b *Bleve) Index(d Doc) error {
	return b.idx.Index(d.ID, bleveDoc{Title: d.Title, Body: d.Body, Pod: d.PodID})
}

func (b *Bleve) Delete(id string) error {
	return b.idx.Delete(id)
}

func (b *Bleve) Search(q Query) (Result, error) {
	title := bleve.NewMatchQuery(q.Text)
	title.SetField("title")
	title.SetOperator(query.MatchQueryOperatorAnd)
	title.SetBoost(2)

	body := bleve.NewMatchQuery(q.Text)
	body.SetField("body")
	body.SetOperator(query.MatchQueryOperatorAnd)

	text := bleve.NewDisjunctionQuery(title, body)
	pod := bleve.NewTermQuery(q.PodID)
	pod.SetField("pod")

	req := bleve.NewSearchRequestOptions(bleve.NewConjunctionQuery(text, pod), q.Limit, q.Offset, false)
	res, err := b.idx.Search(req)
	if err != nil {
		return Result{}, fmt.Errorf("search: %w", err)
	}
	ids := make([]string, 0, len(res.Hits))
	for _, h := range res.Hits {
		ids = append(ids, h.ID)
	}
	return Result{Total: res.Total, IDs: ids}, nil
}

func (b *Bleve) Close() error {
	return b.idx.Close()
}
