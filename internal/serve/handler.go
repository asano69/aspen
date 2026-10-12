package serve

import (
	"net/http"

	"github.com/asano69/cardpot/internal/realtime"
	"github.com/asano69/cardpot/internal/replica"
	"github.com/asano69/cardpot/internal/static"
	"github.com/asano69/cardpot/internal/version"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	yjsws "github.com/reearth/ygo/provider/websocket"
)

// yjsServer is a single in-memory Yjs sync server shared by every room.
// PoC only (see docs/yjs-design.md): no auth yet. Its persistence
// adapter (ydocPersistence, see ydoc.go) reads and writes the matching
// card's "ydoc" field, so that field -- not this in-memory server --
// remains the single source of truth. Constructed lazily by
// initYjsServer once the PocketBase app instance is available.
var yjsServer *yjsws.Server

// registerRoutes wires up every HTTP route served by cardpot. It is passed
// to app.OnServe().BindFunc in serve.go, keeping all route/handler
// definitions in this file while serve.go stays focused on server setup
// and startup.
func registerRoutes(e *core.ServeEvent) error {
	initYjsServer(e.App)

	// Public routes: no auth required. Keep this list limited to
	// endpoints that return no user data (version info, health checks,
	// the static SPA shell below).
	e.Router.GET("/api/version", func(re *core.RequestEvent) error {
		return re.JSON(http.StatusOK, map[string]string{"version": version.Version})
	})

	e.Router.GET("/health", func(re *core.RequestEvent) error {
		return re.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})

	// Real-time Yjs sync (see docs/yjs-design.md). {room} is the "cards"
	// record id. The auth token comes in the "token" query parameter and is
	// checked before the upgrade (see yjs_auth.go).
	e.Router.GET("/yjs/{room}", apis.WrapStdHandler(yjsAuth(e.App, yjsServer)))

	// Realtime card events (see internal/realtime). Authentication happens
	// inside the hub (any valid auth token), not via this router's middleware.
	hub, err := realtime.Register(e)
	if err != nil {
		return err
	}
	// A duplicate card title is announced to clients through the hub (see
	// title_watch.go).
	titleWatcherInstance.notify = hub.PublishMergeAlert
	titleWatcherInstance.notifyRename = hub.PublishRenameAlert

	// Custom API routes that return or mutate user data go under this
	// group so RequireAuth only has to be declared once here, instead of
	// on every individual route. Any authenticated record (a regular user
	// or a superuser) is accepted; per-pot permissions do not exist yet.
	// The path keeps its "admin" name only to avoid churn in the frontend,
	// scripts and generated types.
	admin := e.Router.Group("/api/admin")
	admin.Bind(apis.RequireAuth())
	admin.POST("/cards", createCardHandler)
	admin.POST("/cards/move", moveCardsHandler)
	admin.POST("/cards/{id}/rename-links", renameLinksHandler)
	admin.GET("/cards/{id}/seen", getSeenHandler)
	admin.POST("/cards/{id}/seen", postSeenHandler)
	admin.POST("/attachments", uploadAttachmentHandler)

	// Public-data-shaped but still gated behind authentication (any
	// regular user or superuser), since it returns the same card fields
	// the "cards"/"card_links" collections themselves do.
	pages := e.Router.Group("/api/pages")
	pages.Bind(apis.RequireAuth())
	// links1hop / links2hop are meant for external callers such as agents. The
	// frontend does not use them: it derives the same rows from its Dexie
	// replica (see frontend/src/lib/dexie/relatedQuery.ts), checked against
	// the same fixture (testdata/link-graph.json).
	pages.GET("/{pot}/{slug}/links1hop", relatedCardsHandler("links1hop", links1Hop))
	pages.GET("/{pot}/{slug}/links2hop", relatedCardsHandler("links2hop", links2Hop))
	// Checkpoint-based pull for the frontend's Dexie replication (see
	// replication.go), one route per replicated collection. {potId} is a
	// pot's id, unlike {pot} above.
	for _, c := range replica.Collections {
		pages.GET("/{potId}/"+c.Name+"/pull", pullHandler(c))
	}

	// Serves the whole Vite build output (index.html, hashed JS/CSS
	// under assets/, and public/ files like favicon.svg copied to the
	// root) from a single route. indexFallback=true makes any unmatched
	// path (e.g. /manifests/abc, /settings) fall back to index.html, so
	// Solid Router can handle it client-side even on a hard refresh.
	// This shell is left unauthenticated on purpose: it's an empty
	// HTML/JS bundle with no data in it. Every route that actually
	// returns collection data is guarded below with
	// RequireAuth, so an unauthenticated visitor only ever
	// sees the login screen the SPA renders client-side.
	e.Router.GET("/{path...}", apis.Static(static.FS, true))

	return e.Next()
}
