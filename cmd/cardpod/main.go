package main

import (
	"os"

	"github.com/pocketbase/pocketbase"
	pbcmd "github.com/pocketbase/pocketbase/cmd"

	"github.com/asano69/cardpod/internal/version"
	_ "github.com/asano69/cardpod/migrations"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
)

// dataDirEnvVar lets the data directory be set via environment variable
// instead of always requiring the "--dir" flag. If unset, PocketBase
// falls back to its own default (a "pb_data" folder next to the binary).
const dataDirEnvVar = "CARDPOD_DATA_DIR"

func main() {
	app := pocketbase.NewWithConfig(pocketbase.Config{
		HideStartBanner: true,
		// Sets the "--dir" flag's default value. An explicit "--dir"
		// still overrides this, so the flag keeps working as before.
		DefaultDataDir: os.Getenv(dataDirEnvVar),
	})

	// Registers "cardpod migrate up/down/create/collections/history-sync"
	// for manual or CI-driven schema management. Automigrate is off because
	// the schema is defined purely in Go migration files (internal/migrations),
	// not edited through the PocketBase dashboard.
	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Automigrate: false,
	})

	root := app.RootCmd
	root.Use = "cardpod"
	root.Short = "cardpod"
	root.SilenceUsage = true
	root.Version = version.Version

	root.AddCommand(
		serveCmd(app),
		importCmd(app),
		reindexCmd(app),
		pbcmd.NewSuperuserCommand(app),
	)

	if err := app.Execute(); err != nil {
		os.Exit(1)
	}
}
