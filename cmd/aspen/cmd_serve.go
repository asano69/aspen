package main

import (
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase"
	"github.com/spf13/cobra"

	"github.com/asano69/aspen/internal/config"
	"github.com/asano69/aspen/internal/serve"
)

// serveCmd defines the "aspen serve" cobra command. RunE stays a thin
// wrapper: load config, then delegate to internal/serve for the actual
// server implementation.
//
// --host/--port are optional overrides on top of config.Load()'s env-based
// config. cmd.Flags().Changed is checked so an unset flag never clobbers a
// value that came from ASPEN_SERVER_HOST/ASPEN_SERVER_PORT.
func serveCmd(app *pocketbase.PocketBase) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Start the web server",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			// --dev also raises the default slog level to Debug, so
			// slog.Debug calls throughout the codebase (e.g.
			// internal/serve/ydoc.go's XML dump) become visible without
			// a separate flag to remember.
			if app.IsDev() {
				slog.SetLogLoggerLevel(slog.LevelDebug)
			}

			cfg, err := config.Load()
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}

			if cmd.Flags().Changed("host") {
				cfg.Server.Host, err = cmd.Flags().GetString("host")
				if err != nil {
					return err
				}
			}
			if cmd.Flags().Changed("port") {
				cfg.Server.Port, err = cmd.Flags().GetInt("port")
				if err != nil {
					return err
				}
			}

			return serve.Run(app, cfg)
		},
	}

	cmd.Flags().String("host", "", "Server host, overrides ASPEN_SERVER_HOST")
	cmd.Flags().Int("port", 0, "Server port, overrides ASPEN_SERVER_PORT")

	return cmd
}
