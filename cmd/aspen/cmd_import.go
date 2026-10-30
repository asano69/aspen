package main

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"runtime/pprof"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/spf13/cobra"

	"github.com/asano69/aspen/internal/serve"
)

const (
	formatFolder  = "folder"
	formatCosense = "cosense"
)

// importCmd defines the "aspen import" cobra command. RunE stays a thin
// wrapper: it checks the arguments, asks for confirmation, then delegates to
// internal/serve for the import.
func importCmd(app *pocketbase.PocketBase) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "import <dir>",
		Short: "Import a pod from an export folder",
		Long: `Import a folder written by "aspen export".

The pod named by pod_name in the folder's manifest.json is created when it does
not exist (with pod_title as its title), or has its cards overwritten when it
does. Cards are matched by title. You are always asked to confirm; pass --force
to skip the question.

A Cosense JSON export can be imported too, into a pod that already exists:

  aspen import --format cosense data.json --pod <name>

Stop the server before running this command.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, _ := cmd.Flags().GetString("format")
			pod, _ := cmd.Flags().GetString("pod")
			force, _ := cmd.Flags().GetBool("force")

			if path, _ := cmd.Flags().GetString("cpuprofile"); path != "" {
				stop, err := startCPUProfile(path)
				if err != nil {
					return err
				}
				defer stop()
			}

			switch format {
			case formatFolder:
				if pod != "" {
					return errors.New("--pod only applies to --format cosense: a folder names its pod in manifest.json")
				}
				err := runFolderImport(cmd, app, args[0], force)
				return finish(cmd, err)
			case formatCosense:
				if pod == "" {
					return errors.New("--format cosense needs --pod <name>")
				}
				err := runCosenseImport(cmd, app, args[0], pod, force)
				return finish(cmd, err)
			default:
				return fmt.Errorf("unknown --format %q (want %q or %q)", format, formatFolder, formatCosense)
			}
		},
	}
	cmd.Flags().StringP("format", "f", formatFolder, `Input format: "folder" (an export folder) or "cosense" (a JSON file)`)
	cmd.Flags().String("pod", "", "Pod to import into (--format cosense only)")
	cmd.Flags().Bool("force", false, "Do not ask for confirmation")
	cmd.Flags().String("cpuprofile", "", "Write a CPU profile of the import to this file")
	cmd.Flags().Bool("timings", false, "Print the total time spent in each stage of the import")
	return cmd
}

// finish prints the timings (when asked) after a successful import and
// returns err unchanged.
func finish(cmd *cobra.Command, err error) error {
	if err != nil {
		return err
	}
	if timings, _ := cmd.Flags().GetBool("timings"); timings {
		fmt.Fprint(cmd.OutOrStdout(), serve.StageReport())
	}
	return nil
}

// runFolderImport imports an export folder after confirmation.
func runFolderImport(cmd *cobra.Command, app *pocketbase.PocketBase, dir string, force bool) error {
	plan, err := serve.PlanImport(app, dir)
	if err != nil {
		return err
	}

	question := fmt.Sprintf("Create pod %q (%s) and import %d cards?", plan.PodName, plan.PodTitle, plan.Cards)
	if plan.PodExists {
		question = fmt.Sprintf("Pod %q exists. Overwrite its cards with the same title with %d cards?", plan.PodName, plan.Cards)
	}
	if err := confirmOrForce(cmd, question, force); err != nil {
		return err
	}

	result, err := serve.ApplyImport(app, plan, progressPrinter(cmd))
	fmt.Fprintln(cmd.ErrOrStderr()) // ends the progress line
	if err != nil {
		return err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "imported into %q: %d created, %d overwritten\n",
		plan.PodName, result.Created, result.Overwritten)
	return nil
}

// runCosenseImport imports a Cosense JSON file into an existing pod after
// confirmation.
func runCosenseImport(cmd *cobra.Command, app *pocketbase.PocketBase, path, pod string, force bool) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open %s: %w", path, err)
	}
	defer file.Close()

	question := fmt.Sprintf("Import %s into pod %q, overwriting cards with the same title?", path, pod)
	if err := confirmOrForce(cmd, question, force); err != nil {
		return err
	}

	result, err := serve.ImportCosense(app, pod, file, progressPrinter(cmd))
	fmt.Fprintln(cmd.ErrOrStderr()) // ends the progress line
	if err != nil {
		return err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "imported into %q: %d created, %d overwritten\n",
		pod, result.Created, result.Overwritten)
	return nil
}

// progressPrinter writes progress to stderr, so stdout keeps only the final
// summary. "\r" rewrites the same line instead of printing one per card.
func progressPrinter(cmd *cobra.Command) func(done, total int) {
	return func(done, total int) {
		fmt.Fprintf(cmd.ErrOrStderr(), "\rimporting: %d/%d", done, total)
	}
}

// confirmOrForce returns nil when the user agrees, or when force is set. It
// returns an error when the user declines, or when there is no terminal to ask
// on.
func confirmOrForce(cmd *cobra.Command, question string, force bool) error {
	if force {
		return nil
	}
	if !isTerminal(os.Stdin) {
		return errors.New("cannot ask for confirmation without a terminal: pass --force to import anyway")
	}
	ok, err := confirm(cmd.InOrStdin(), cmd.ErrOrStderr(), question)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("import canceled")
	}
	return nil
}

// confirm prints question and reads one line: "y" or "yes" (any case) means
// yes, anything else, including an empty line, means no.
func confirm(in io.Reader, out io.Writer, question string) (bool, error) {
	fmt.Fprintf(out, "%s [y/N] ", question)
	line, err := bufio.NewReader(in).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return false, fmt.Errorf("read answer: %w", err)
	}
	switch strings.ToLower(strings.TrimSpace(line)) {
	case "y", "yes":
		return true, nil
	}
	return false, nil
}

// isTerminal reports whether f is an interactive terminal.
func isTerminal(f *os.File) bool {
	info, err := f.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
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
