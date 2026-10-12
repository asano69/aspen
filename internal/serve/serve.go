// Package serve implements the "serve" command, which runs a single HTTP server
// that hosts the index page and all drill sessions defined in the config file.
//
// The package is split across three files:
//   - serve.go:   route registration and server startup (this file)
//   - handler.go: HTTP handlers
//   - ydoc.go:    periodic Yjs snapshot persistence
package serve

import (
	"fmt"

	"log/slog"

	"github.com/asano69/cardpot/internal/config"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
)

// Run opens the database and collection once, registers all routes (see
// registerRoutes in handler.go), then starts listening. The database and
// collection are shared across all sessions.
func Run(app *pocketbase.PocketBase, cfg *config.Config) error {
	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)

	app.OnServe().BindFunc(registerRoutes)
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
