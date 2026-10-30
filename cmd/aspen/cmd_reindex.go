package main

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	"github.com/spf13/cobra"

	"github.com/asano69/aspen/internal/serve"
)

// reindexCmd rebuilds the full-text index from card_ydocs.
// Run it while the server is stopped (Bleve allows one writer).
func reindexCmd(app core.App) *cobra.Command {
	return &cobra.Command{
		Use:   "reindex",
		Short: "Rebuild the full-text search index from all cards",
		RunE: func(cmd *cobra.Command, args []string) error {
			n, err := serve.Reindex(app)
			if err != nil {
				return fmt.Errorf("reindex failed: %w", err)
			}
			fmt.Printf("indexed %d cards\n", n)
			return nil
		},
	}
}
