// Package serve implements the "serve" command, which runs a single HTTP server
// that hosts the index page and all drill sessions defined in the config file.
//
// The package is split across these files, among others:
//   - serve.go:   route registration and server startup (this file)
//   - handler.go: HTTP handlers
//   - rooms.go:   open cards, edited live through cmgo's collab server
//   - contents.go: the "card_contents" rows that hold the text of every card
package serve

import (
	"fmt"

	"log/slog"

	"github.com/asano69/cardpod/internal/config"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
)

// Run opens the database and collection once, registers all routes (see
// registerRoutes in handler.go), then starts listening. The database and
// collection are shared across all sessions.
func Run(app *pocketbase.PocketBase, cfg *config.Config) error {
	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)

	app.OnServe().BindFunc(registerRoutes)
	app.OnServe().BindFunc(openSearchEngine)
	registerValidationHooks(app)
	registerLinkCleanupHooks(app)
	registerSearchHooks(app)
	registerGeneratedImageHooks(app)

	slog.Info("listening", "addr", addr)
	return apis.Serve(app, apis.ServeConfig{
		HttpAddr:        addr,
		ShowStartBanner: false,
	})
}
