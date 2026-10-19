package main

import (
	"fmt"
	"os"
	"runtime/pprof"

	"github.com/pocketbase/pocketbase"
	"github.com/spf13/cobra"

	"github.com/asano69/cardpot/internal/serve"
)

// importCmd defines the "cardpot import" cobra command. RunE stays a thin
// wrapper: open the file, then delegate to internal/serve for the import.
func importCmd(app *pocketbase.PocketBase) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "import <file> <pot>",
		Short: "Import cards from a JSON export into a pot",
		Long: `Import cards from a JSON export into the pot with the given name.

The file must look like:

  {"pages": [{"title": "page title", "lines": ["page title", "line 2"]}]}

A page whose title matches an existing card in the pot overwrites that
card's body; any other page becomes a new card. Stop the server before
running this command.`,
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			file, err := os.Open(args[0])
			if err != nil {
				return fmt.Errorf("open %s: %w", args[0], err)
			}
			defer file.Close()

			if path, _ := cmd.Flags().GetString("cpuprofile"); path != "" {
				stop, err := startCPUProfile(path)
				if err != nil {
					return err
				}
				defer stop()
			}

			// Progress goes to stderr, so stdout keeps only the final summary.
			// "\r" rewrites the same line instead of printing one per page.
			progress := func(done, total int) {
				fmt.Fprintf(cmd.ErrOrStderr(), "\rimporting: %d/%d", done, total)
			}
			result, err := serve.Import(app, args[1], file, progress)
			// Ends the progress line, so the summary or the error starts fresh.
			fmt.Fprintln(cmd.ErrOrStderr())
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "imported into %q: %d created, %d overwritten\n",
				args[1], result.Created, result.Overwritten)
			if timings, _ := cmd.Flags().GetBool("timings"); timings {
				fmt.Fprint(cmd.OutOrStdout(), serve.StageReport())
			}
			return nil
		},
	}
	cmd.Flags().String("cpuprofile", "", "Write a CPU profile of the import to this file")
	cmd.Flags().Bool("timings", false, "Print the total time spent in each stage of the import")
	return cmd
}

// startCPUProfile starts a CPU profile written to path and returns the
// function that stops it and closes the file.
func startCPUProfile(path string) (stop func(), err error) {
	f, err := os.Create(path)
	if err != nil {
		return nil, fmt.Errorf("create %s: %w", path, err)
	}
	if err := pprof.StartCPUProfile(f); err != nil {
		f.Close()
		return nil, fmt.Errorf("start CPU profile: %w", err)
	}
	return func() {
		pprof.StopCPUProfile()
		f.Close()
	}, nil
}
