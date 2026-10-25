package serve

import (
	"log/slog"
	"net/http"
	"path/filepath"

	"github.com/asano69/cardpod/internal/linesign"
	"github.com/asano69/cardpod/internal/realtime"
	"github.com/asano69/cardpod/internal/replica"
	"github.com/asano69/cardpod/internal/static"
	"github.com/asano69/cardpod/internal/version"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// registerRoutes wires up every HTTP route served by cardpod. It is passed
// to app.OnServe().BindFunc in serve.go, keeping all route/handler
// definitions in this file while serve.go stays focused on server setup
// and startup.
func registerRoutes(e *core.ServeEvent) error {
	// The open cards (see rooms.go). Whatever is still unsaved is written when
	// the server stops.
	// The key that signs the lines of every card (see internal/linesign). It is
	// created on the first start and kept in the data directory.
	signer, err := linesign.Load(filepath.Join(e.App.DataDir(), "server_key.pem"))
	if err != nil {
		return err
	}
	slog.Info("line signing key", "public", signer.PublicKey())

	liveRooms = newRooms(e.App)
	liveRooms.signer = signer
	e.App.OnTerminate().BindFunc(func(te *core.TerminateEvent) error {
		liveRooms.flush()
		return te.Next()
	})

	// Public routes: no auth required. Keep this list limited to
	// endpoints that return no user data (version info, health checks,
	// the static SPA shell below).
	e.Router.GET("/api/version", func(re *core.RequestEvent) error {
		return re.JSON(http.StatusOK, map[string]string{"version": version.Version})
	})

	e.Router.GET("/health", func(re *core.RequestEvent) error {
		return re.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})

	// Real-time editing of one card (see rooms.go). {room} is the "cards"
	// record id. The auth token comes in the "token" query parameter and is
	// checked before the upgrade (see collab_auth.go).
	e.Router.GET("/collab/{room}", apis.WrapStdHandler(collabAuth(e.App, liveRooms)))

	// Realtime card events (see internal/realtime). Authentication happens
	// inside the hub (any valid auth token), not via this router's middleware.
	hub, err := realtime.Register(e)
	// err was declared above by linesign.Load; hub is new, so := stays valid.
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
	pages.GET("/{pot}/search/query", searchHandler)
	// links1hop / links2hop are meant for external callers such as agents. The
	// frontend does not use them: it derives the same rows from its Dexie
	// replica (see frontend/src/lib/dexie/relatedQuery.ts), checked against
	// the same fixture (testdata/link-graph.json).
	pages.GET("/{pot}/{slug}/links1hop", relatedCardsHandler("links1hop", links1Hop))
	pages.GET("/{pot}/{slug}/links2hop", relatedCardsHandler("links2hop", links2Hop))
	// Checkpoint-based pull for the frontend's Dexie replication (see
	// replication.go), one route per replicated collection. {potId} is a
	// pot's id, unlike {pot} above. A global collection (e.g. pots) has no
	// pot segment.
	for _, c := range replica.Collections {
		if c.PotField == "" {
			pages.GET("/"+c.Name+"/pull", pullHandler(c))
		} else {
			pages.GET("/{potId}/"+c.Name+"/pull", pullHandler(c))
		}
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
