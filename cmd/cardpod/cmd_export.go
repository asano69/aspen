package main

import (
	"fmt"

	"github.com/pocketbase/pocketbase"
	"github.com/spf13/cobra"

	"github.com/asano69/cardpod/internal/serve"
)

// exportCmd defines the "cardpod export" cobra command. RunE stays a thin
// wrapper: delegate to internal/serve, which writes the directory.
func exportCmd(app *pocketbase.PocketBase) *cobra.Command {
	return &cobra.Command{
		Use:   "export <pot> <dir>",
		Short: "Export one pot to a directory",
		Long: `Export the current state of the pot with the given name to a directory.

The directory gets a manifest.json that lists every file, the text and the
signed lines of every card in cards/, and the attachments they use in assets/.
Stop the server before running this command.`,
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			result, err := serve.Export(app, args[0], args[1])
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "exported %d cards and %d attachments from %q to %s\n",
				result.Cards, result.Assets, args[0], args[1])
			return nil
		},
	}
}
