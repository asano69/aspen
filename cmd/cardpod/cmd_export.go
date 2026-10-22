package main

import (
	"fmt"
	"os"

	"github.com/pocketbase/pocketbase"
	"github.com/spf13/cobra"

	"github.com/asano69/cardpod/internal/serve"
)

// exportCmd defines the "cardpod export" cobra command. RunE stays a thin
// wrapper: create the output file, then delegate to internal/serve.
func exportCmd(app *pocketbase.PocketBase) *cobra.Command {
	return &cobra.Command{
		Use:   "export <file>",
		Short: "Export every card to a zip archive of .csn files",
		Long: `Export the current state of every card to a zip archive.

Each pot becomes a folder named after its id, and each card a "<title>.csn"
file inside it holding the card's full text. Stop the server before running
this command.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			file, err := os.Create(args[0])
			if err != nil {
				return fmt.Errorf("create %s: %w", args[0], err)
			}
			defer file.Close()

			result, err := serve.Export(app, file)
			if err != nil {
				return err
			}
			if err := file.Close(); err != nil {
				return fmt.Errorf("close %s: %w", args[0], err)
			}
			fmt.Fprintf(cmd.OutOrStdout(), "exported %d cards from %d pots to %s\n",
				result.Cards, result.Pots, args[0])
			return nil
		},
	}
}
