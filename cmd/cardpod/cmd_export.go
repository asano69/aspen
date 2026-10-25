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
		Use:   "export <pot> <file>",
		Short: "Export one pot to a zip archive",
		Long: `Export the current state of the pot with the given name to a zip archive.

The archive holds a folder named after the pot, with the text and the signed
lines of every card in cards/ and the attachments they use in assets/. Stop
the server before running this command.`,
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			file, err := os.Create(args[1])
			if err != nil {
				return fmt.Errorf("create %s: %w", args[1], err)
			}
			defer file.Close()

			result, err := serve.Export(app, args[0], file)
			if err != nil {
				return err
			}
			if err := file.Close(); err != nil {
				return fmt.Errorf("close %s: %w", args[1], err)
			}
			fmt.Fprintf(cmd.OutOrStdout(), "exported %d cards and %d attachments from %q to %s\n",
				result.Cards, result.Assets, args[0], args[1])
			return nil
		},
	}
}
