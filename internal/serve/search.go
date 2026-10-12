package serve

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpot/internal/api"
	"github.com/asano69/cardpot/internal/search"
)

// searchEngine is set once at startup (or by CLI commands) and may be nil
// when search is not configured.
var searchEngine search.Engine

// openSearchEngine opens the Bleve index next to the PocketBase data and
// closes it on shutdown. The reindex command opens it the same way.
func openSearchEngine(e *core.ServeEvent) error {
	engine, err := search.OpenBleve(filepath.Join(e.App.DataDir(), "search.bleve"))
	if err != nil {
		return err
	}
	searchEngine = engine
	e.App.OnTerminate().BindFunc(func(te *core.TerminateEvent) error {
		if err := engine.Close(); err != nil {
			slog.Warn("close search index", "error", err)
		}
		return te.Next()
	})
	return e.Next()
}

// splitTitleBody treats the first line as the title, like the card list does.
func splitTitleBody(text string) (title, body string) {
	title, body, _ = strings.Cut(text, "\n")
	return strings.TrimSpace(title), body
}

// indexCard (re)indexes one card from its current text.
func indexCard(app core.App, cardID, text string) error {
	if searchEngine == nil {
		return nil
	}
	card, err := app.FindRecordById("cards", cardID)
	if err != nil {
		return err
	}
	title, body := splitTitleBody(text)
	return searchEngine.Index(search.Doc{
		ID: cardID, PotID: card.GetString("pot"), Title: title, Body: body,
	})
}

// registerSearchHooks removes soft-deleted cards from the index.
func registerSearchHooks(app core.App) {
	app.OnRecordAfterUpdateSuccess("cards").BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if searchEngine == nil || e.Record.GetDateTime("deleted").IsZero() {
			return nil
		}
		if err := searchEngine.Delete(e.Record.Id); err != nil {
			slog.Warn("search: delete from index failed", "card", e.Record.Id, "err", err)
		}
		return nil
	})
}

// searchHandler serves GET /api/pages/{pot}/search/query?q=keyword.
func searchHandler(e *core.RequestEvent) error {
	if searchEngine == nil {
		return apis.NewApiError(http.StatusServiceUnavailable, "Search is not enabled on this server.", nil)
	}
	q := strings.TrimSpace(e.Request.URL.Query().Get("q"))
	if q == "" {
		return e.JSON(http.StatusOK, api.SearchResponse{Items: []api.SearchItem{}})
	}
	pot, err := e.App.FindFirstRecordByFilter("pots", "name = {:name}", map[string]any{"name": e.Request.PathValue("pot")})
	if err != nil {
		return apis.NewNotFoundError("Pot not found.", err)
	}
	res, err := searchEngine.Search(search.Query{Text: q, PotID: pot.Id, Limit: 50})
	if err != nil {
		return apis.NewApiError(http.StatusInternalServerError, "Search failed. Please try again.", err)
	}
	items := make([]api.SearchItem, 0, len(res.IDs))
	for _, id := range res.IDs { // keep engine ranking order
		card, err := e.App.FindRecordById("cards", id)
		if err != nil || !card.GetDateTime("deleted").IsZero() {
			continue
		}
		var preview []string
		_ = json.Unmarshal([]byte(card.GetString("description")), &preview)
		items = append(items, api.SearchItem{
			ID: card.Id, Title: card.GetString("title"), Preview: preview,
		})
	}
	return e.JSON(http.StatusOK, api.SearchResponse{Total: int(res.Total), Items: items})
}

// loadCardText returns the current text of a card, read from its stored
// update log (or from its live room, when one is loaded).
func loadCardText(app core.App, card *core.Record) (string, error) {
	doc, _, err := loadCardDoc(&ydocPersistence{app: app}, card.Id)
	if err != nil {
		return "", err
	}
	return doc.GetText("content").ToString(), nil
}

// Reindex rebuilds the whole index; used by `cardpot reindex`. It opens the
// index itself, so the server must be stopped (Bleve allows one writer).
func Reindex(app core.App) (int, error) {
	engine, err := search.OpenBleve(filepath.Join(app.DataDir(), "search.bleve"))
	if err != nil {
		return 0, err
	}
	defer engine.Close()
	searchEngine = engine
	cards, err := app.FindRecordsByFilter("cards", "deleted = ''", "", 0, 0, nil)
	if err != nil {
		return 0, err
	}
	for _, c := range cards {
		text, err := loadCardText(app, c) // see rename_links.go loadCardDoc
		if err != nil {
			return 0, fmt.Errorf("card %s: %w", c.Id, err)
		}
		if err := indexCard(app, c.Id, text); err != nil {
			return 0, err
		}
	}
	return len(cards), nil
}
