// import.go implements "cardpod import". Its main form loads a folder written
// by "cardpod export": the pod named in the manifest is created when it does
// not exist, and its cards overwrite the cards with the same title. A second,
// secondary form (ImportCosense) loads pages from a Cosense JSON export into a
// pod that already exists.
//
// A card body is written to its content row (see contents.go), the same way a
// live editing session stores it. Only the card record itself (pod, title,
// position) is created the way createCardHandler creates it.
//
// The command opens the data directory in its own process, so run it while
// the server is stopped: a card the running server already has open would not
// see the imported content.
package serve

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"

	"github.com/asano69/cardpod/internal/lineid"
	"github.com/asano69/cardpod/internal/slug"
)

// The JSON layout accepted by Import is {"pages": [...]}. Unknown fields are
// ignored so richer exports can be fed in unchanged.
type importPage struct {
	Title string      `json:"title"`
	Lines importLines `json:"lines"`
}

// importLines is the "lines" array of a page. Each entry is either a plain
// string (the simple format) or an object with a "text" field (the Scrapbox
// export format, whose other fields are ignored).
type importLines []string

func (l *importLines) UnmarshalJSON(data []byte) error {
	var raw []json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	lines := make(importLines, len(raw))
	for i, entry := range raw {
		text, err := lineText(entry)
		if err != nil {
			return fmt.Errorf("lines[%d]: %w", i, err)
		}
		lines[i] = text
	}
	*l = lines
	return nil
}

// lineText reads one entry of "lines": a JSON string, or an object with a
// "text" string.
func lineText(entry json.RawMessage) (string, error) {
	var text string
	if err := json.Unmarshal(entry, &text); err == nil {
		return text, nil
	}
	var object struct {
		Text *string `json:"text"`
	}
	if err := json.Unmarshal(entry, &object); err != nil || object.Text == nil {
		return "", errors.New(`must be a string or an object with a "text" string`)
	}
	return *object.Text, nil
}

// importBatchSize is how many pages are committed in one database
// transaction. One transaction per page makes SQLite commit hundreds of
// thousands of times on a large export. A failure rolls back only the
// current batch, and re-running the import overwrites cards by title, so
// it is safe to retry.
const importBatchSize = 500

// ImportResult counts what an import did.
type ImportResult struct {
	Created     int
	Overwritten int
}

// pageSpan is the byte range of one page inside the import file. Only these
// ranges are kept in memory, never the pages themselves, so a file far larger
// than the available memory can be imported.
type pageSpan struct{ off, n int64 }

// checkPage trims and validates a decoded page.
func checkPage(page *importPage) error {
	// Trimmed like the editor's own title candidates (see
	// makeTitleCandidate in frontend/src/lib/models/card.ts).
	page.Title = strings.TrimSpace(page.Title)
	if page.Title == "" {
		return errors.New("no title")
	}
	return nil
}

// expectDelim reads the next token and fails unless it is the delimiter want.
func expectDelim(dec *json.Decoder, want json.Delim) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	if got, ok := tok.(json.Delim); !ok || got != want {
		return fmt.Errorf("expected %q, got %v", want, tok)
	}
	return nil
}

// indexPages streams through the file once, validating every page and
// recording where it is, so a bad file is rejected before anything is written.
// Each page is decoded and dropped right away.
func indexPages(r io.ReaderAt) ([]pageSpan, error) {
	dec := json.NewDecoder(io.NewSectionReader(r, 0, math.MaxInt64))
	if err := expectDelim(dec, '{'); err != nil {
		return nil, fmt.Errorf("invalid import file: %w", err)
	}

	var spans []pageSpan
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, fmt.Errorf("invalid import file: %w", err)
		}
		if key, _ := tok.(string); key != "pages" {
			var skipped json.RawMessage
			if err := dec.Decode(&skipped); err != nil {
				return nil, fmt.Errorf("invalid import file: %w", err)
			}
			continue
		}

		if err := expectDelim(dec, '['); err != nil {
			return nil, fmt.Errorf("invalid import file: pages: %w", err)
		}
		for dec.More() {
			// The range may start with the comma that follows the previous
			// page; readPage trims it.
			start := dec.InputOffset()
			var page importPage
			if err := dec.Decode(&page); err != nil {
				return nil, fmt.Errorf("invalid import file: pages[%d]: %w", len(spans), err)
			}
			if err := checkPage(&page); err != nil {
				return nil, fmt.Errorf("invalid import file: pages[%d] has %w", len(spans), err)
			}
			spans = append(spans, pageSpan{off: start, n: dec.InputOffset() - start})
		}
		if err := expectDelim(dec, ']'); err != nil {
			return nil, fmt.Errorf("invalid import file: pages: %w", err)
		}
	}
	return spans, nil
}

// readPage reads one page back from the file (see indexPages).
func readPage(r io.ReaderAt, span pageSpan) (importPage, error) {
	var page importPage
	data, err := io.ReadAll(io.NewSectionReader(r, span.off, span.n))
	if err != nil {
		return page, err
	}
	data = bytes.TrimLeft(data, " \t\r\n,")
	if err := json.Unmarshal(data, &page); err != nil {
		return page, err
	}
	return page, checkPage(&page)
}

// ImportCosense reads a Cosense JSON export from r and imports its pages into
// the pod named podName, which must already exist. A page whose title matches
// an existing card in that pod overwrites the card's body; any other page
// becomes a new card.
//
// The file is read twice, one page at a time (see indexPages and readPage),
// so memory use does not grow with the file's size.
//
// progress, when not nil, is called after each page with the number of pages
// done so far and the total.
func ImportCosense(app core.App, podName string, r io.ReaderAt, progress func(done, total int)) (ImportResult, error) {
	var result ImportResult

	spans, err := indexPages(r)
	if err != nil {
		return result, err
	}

	pod, err := findImportPod(app, podName)
	if err != nil {
		return result, err
	}

	return runBatched(app, len(spans), progress, func(tx core.App, i int) (bool, error) {
		stop := stages.start("read page")
		page, err := readPage(r, spans[i])
		stop()
		if err != nil {
			return false, fmt.Errorf("read page %d: %w", i, err)
		}
		created, err := importImportedPage(tx, pod.Id, page)
		if err != nil {
			return false, fmt.Errorf("import page %q: %w", page.Title, err)
		}
		return created, nil
	})
}

// errPodNotFound is wrapped by findImportPod when the pod does not exist.
var errPodNotFound = errors.New("no such pod")

// findImportPod returns the live pod an import writes into. The error wraps
// errPodNotFound when there is none.
func findImportPod(app core.App, podName string) (*core.Record, error) {
	pod, err := app.FindFirstRecordByFilter(
		"pods", "name = {:name} && "+notDeleted, dbx.Params{"name": podName},
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("pod %q not found: %w", podName, errPodNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("find pod %q: %w", podName, err)
	}
	return pod, nil
}

// ImportPlan describes what importing an export folder would do. PlanImport
// builds it without changing anything, so a caller can ask for confirmation
// first.
type ImportPlan struct {
	// PodName and PodTitle come from the manifest.
	PodName  string
	PodTitle string
	// PodExists is true when a live pod with PodName exists already: the import
	// then overwrites its cards with the same title. Otherwise the pod is
	// created.
	PodExists bool
	// Cards and Assets count what the folder holds.
	Cards  int
	Assets int

	dir      string
	manifest manifest
}

// PlanImport reads the manifest of an export folder and checks it. Nothing is
// written. It fails when the manifest is unreadable, or when the pod does not
// exist and the manifest cannot describe a valid new pod.
func PlanImport(app core.App, dir string) (ImportPlan, error) {
	data, err := os.ReadFile(filepath.Join(dir, manifestName))
	if err != nil {
		return ImportPlan{}, fmt.Errorf("read manifest (is %s an export folder?): %w", dir, err)
	}
	var m manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return ImportPlan{}, fmt.Errorf("invalid manifest: %w", err)
	}
	// Checked before anything else, so an invalid name never reaches the
	// database, whether or not such a pod exists.
	if err := checkPodName(m.PodName); err != nil {
		return ImportPlan{}, fmt.Errorf("invalid manifest: %w", err)
	}
	if err := checkManifestFiles(dir, m); err != nil {
		return ImportPlan{}, err
	}

	plan := ImportPlan{
		PodName:  m.PodName,
		PodTitle: m.PodTitle,
		Cards:    len(m.Cards),
		Assets:   len(m.Assets),
		dir:      dir,
		manifest: m,
	}
	_, err = findImportPod(app, m.PodName)
	switch {
	case err == nil:
		plan.PodExists = true
	case errors.Is(err, errPodNotFound):
		if err := checkNewPod(m); err != nil {
			return ImportPlan{}, err
		}
	default:
		return ImportPlan{}, err
	}
	return plan, nil
}

// podNameRe is the rule of the "pods" collection for a pod name.
var podNameRe = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$`)

const (
	maxPodNameLen  = 48
	maxPodTitleLen = 60
)

// checkPodName reports why name cannot be a pod name, in words a user can act
// on. The same rules are enforced by the collection, but its messages do not
// say which manifest field is at fault.
func checkPodName(name string) error {
	if name == "" {
		return errors.New("pod_name is empty")
	}
	if len(name) > maxPodNameLen || !podNameRe.MatchString(name) {
		return fmt.Errorf("pod_name %q is not a valid pod name: use only letters, digits and hyphens, "+
			"starting and ending with a letter or digit, at most %d characters", name, maxPodNameLen)
	}
	if slug.IsReservedPodName(name) {
		return fmt.Errorf("pod_name %q is reserved", name)
	}
	return nil
}

// checkNewPod reports why the manifest cannot be used to create a pod: its
// title must be usable (the name is checked by checkPodName).
func checkNewPod(m manifest) error {
	title := strings.TrimSpace(m.PodTitle)
	if title == "" {
		return errors.New("pod_title is empty, so the pod cannot be created: " +
			"set pod_title in manifest.json")
	}
	if utf8.RuneCountInString(title) > maxPodTitleLen {
		return fmt.Errorf("pod_title is longer than %d characters", maxPodTitleLen)
	}
	return nil
}

// ApplyImport carries out a plan from PlanImport: it creates the pod when it
// does not exist, then imports the attachments and the cards in manifest
// order. A card is matched by title and overwritten, as in ImportCosense. The
// cover of the manifest replaces the pod's cover; without one, a new pod gets
// a generated cover.
//
// progress, when not nil, is called after each card with the number of cards
// done so far and the total.
func ApplyImport(app core.App, plan ImportPlan, progress func(done, total int)) (ImportResult, error) {
	// Read before the pod is touched, so a missing file creates nothing.
	cover, err := readImportCover(plan)
	if err != nil {
		return ImportResult{}, err
	}
	pod, err := findOrCreateImportPod(app, plan, cover)
	if err != nil {
		return ImportResult{}, err
	}
	return importFolder(app, pod, plan.dir, plan.manifest, progress)
}

// readImportCover reads the cover image named by the manifest, or returns nil
// when it names none.
func readImportCover(plan ImportPlan) (*filesystem.File, error) {
	rel := plan.manifest.Cover
	if rel == "" {
		return nil, nil
	}
	content, err := readExportFile(plan.dir, rel)
	if err != nil {
		return nil, fmt.Errorf("read cover %s: %w", rel, err)
	}
	return filesystem.NewFileFromBytes(content, path.Base(rel))
}

// findOrCreateImportPod returns the pod of the plan, creating it (at the end
// of the pod list) when it does not exist. A non-nil cover replaces the pod's
// cover. A new pod without one gets a generated cover here: the hook that
// does it for the server (see registerGeneratedImageHooks) is not registered
// in this command.
func findOrCreateImportPod(app core.App, plan ImportPlan, cover *filesystem.File) (*core.Record, error) {
	pod, err := findImportPod(app, plan.PodName)
	if err == nil {
		if cover != nil {
			pod.Set("cover", cover)
			if err := app.Save(pod); err != nil {
				return nil, fmt.Errorf("set cover of pod %q: %w", plan.PodName, err)
			}
		}
		return pod, nil
	}
	if !errors.Is(err, errPodNotFound) {
		return nil, err
	}

	collection, err := app.FindCachedCollectionByNameOrId("pods")
	if err != nil {
		return nil, fmt.Errorf("load pods collection: %w", err)
	}
	position, err := nextPodPosition(app)
	if err != nil {
		return nil, err
	}
	pod = core.NewRecord(collection)
	pod.Set("name", plan.PodName)
	pod.Set("title", strings.TrimSpace(plan.PodTitle))
	pod.Set("position", position)
	if cover != nil {
		pod.Set("cover", cover)
	} else {
		podCover.set(pod)
	}
	if err := app.Save(pod); err != nil {
		return nil, fmt.Errorf("create pod %q: %w", plan.PodName, err)
	}
	return pod, nil
}

// nextPodPosition returns a position one past the highest live pod, like the
// frontend does for a pod created in the UI.
func nextPodPosition(app core.App) (float64, error) {
	pods, err := app.FindRecordsByFilter("pods", notDeleted, "-position", 1, 0, nil)
	if err != nil {
		return 0, fmt.Errorf("find the last pod: %w", err)
	}
	if len(pods) == 0 {
		return 0, nil
	}
	return pods[0].GetFloat("position") + 1, nil
}

// importFolder imports the attachments and cards of a manifest into pod.
func importFolder(app core.App, pod *core.Record, dir string, m manifest, progress func(done, total int)) (ImportResult, error) {
	for _, rel := range m.Assets {
		content, err := readExportFile(dir, rel)
		if err != nil {
			return ImportResult{}, err
		}
		if err := importAttachment(app, pod.Id, path.Base(rel), content); err != nil {
			return ImportResult{}, fmt.Errorf("import attachment %s: %w", rel, err)
		}
	}

	return runBatched(app, len(m.Cards), progress, func(tx core.App, i int) (bool, error) {
		card := m.Cards[i]
		// The card is matched in the pod found or created above.
		text, err := readExportFile(dir, card.Text)
		if err != nil {
			return false, err
		}
		lines, err := readExportLines(dir, card.Lines)
		if err != nil {
			return false, err
		}
		created, err := importCard(tx, pod.Id, card.Title, string(text), lines)
		if err != nil {
			return false, fmt.Errorf("import card %q: %w", card.Title, err)
		}
		return created, nil
	})
}

// readExportFile reads a file of an export folder. rel is a "/" path from the
// manifest, and it must stay inside the folder.
func readExportFile(dir, rel string) ([]byte, error) {
	local := filepath.FromSlash(rel)
	if rel == "" || !filepath.IsLocal(local) {
		return nil, fmt.Errorf("%q is not a path inside the export folder", rel)
	}
	return os.ReadFile(filepath.Join(dir, local))
}

// checkManifestFiles checks, before anything is written, that every file the
// manifest names is an existing path inside the export folder. Each error
// names the manifest entry at fault, so the manifest can be fixed by hand.
func checkManifestFiles(dir string, m manifest) error {
	check := func(what, rel string) error {
		if rel == "" {
			return fmt.Errorf("invalid manifest: %s is empty", what)
		}
		local := filepath.FromSlash(rel)
		if !filepath.IsLocal(local) {
			return fmt.Errorf("invalid manifest: %s (%s) is not a path inside the export folder", what, rel)
		}
		if _, err := os.Stat(filepath.Join(dir, local)); err != nil {
			return fmt.Errorf("invalid manifest: %s (%s): %w", what, rel, err)
		}
		return nil
	}

	if m.Cover != "" {
		if err := check(`"cover"`, m.Cover); err != nil {
			return err
		}
	}
	for i, card := range m.Cards {
		where := fmt.Sprintf("cards[%d] (%q)", i, card.Title)
		if err := check(where+` "text"`, card.Text); err != nil {
			return err
		}
		if err := check(where+` "lines"`, card.Lines); err != nil {
			return err
		}
	}
	for i, rel := range m.Assets {
		if err := check(fmt.Sprintf("files[%d]", i), rel); err != nil {
			return err
		}
	}
	return nil
}

// readExportLines reads the signed lines of a card from an export folder.
func readExportLines(dir, rel string) ([]lineid.Line, error) {
	data, err := readExportFile(dir, rel)
	if err != nil {
		return nil, err
	}
	var lines []lineid.Line
	if err := json.Unmarshal(data, &lines); err != nil {
		return nil, fmt.Errorf("invalid lines file %s: %w", rel, err)
	}
	return lines, nil
}

// runBatched calls do for each of total items and counts what it reports.
// New cards get ever-higher positions and the card grid lists the highest
// first, so items are handled last to first, which keeps the source's order
// on screen. do must use the transaction's app, and reports whether it
// created a card (false means it overwrote one).
func runBatched(
	app core.App,
	total int,
	progress func(done, total int),
	do func(tx core.App, i int) (created bool, err error),
) (ImportResult, error) {
	var result ImportResult
	for end := total; end > 0; end -= importBatchSize {
		start := max(0, end-importBatchSize)
		err := app.RunInTransaction(func(tx core.App) error {
			for i := end - 1; i >= start; i-- {
				created, err := do(tx, i)
				if err != nil {
					return err
				}
				if created {
					result.Created++
				} else {
					result.Overwritten++
				}
				if progress != nil {
					progress(result.Created+result.Overwritten, total)
				}
			}
			return nil
		})
		if err != nil {
			return result, err
		}
	}
	return result, nil
}

// importImportedPage creates or finds the card for page and replaces its body.
// It reports whether the card was newly created. A failure after the card
// record was created leaves a card without a note; re-running the import
// fills it in.
func importImportedPage(app core.App, pod string, page importPage) (created bool, err error) {
	return importCard(app, pod, page.Title, pageText(page), nil)
}

// importCard creates or finds the card titled title in pod and replaces its
// text and lines (nil lines keep the stored ones). It reports whether the
// card was newly created.
func importCard(app core.App, pod, title, text string, lines []lineid.Line) (created bool, err error) {
	stop := stages.start("find card")
	card, err := findCardByTitle(app, pod, title)
	stop()
	if err != nil {
		return false, err
	}
	if card == nil {
		stop = stages.start("create card")
		card, err = createImportedCard(app, pod, title, text)
		stop()
		if err != nil {
			return false, err
		}
		created = true
	}

	// Writes the note file and the data derived from it.
	stop = stages.start("replace content")
	err = persistNote(app, card.Id, text, lines)
	stop()
	return created, err
}

// pageText joins a page's lines into the card's plain text. A page without
// lines still needs its title line.
func pageText(page importPage) string {
	if len(page.Lines) == 0 {
		return page.Title
	}
	return strings.Join(page.Lines, "\n")
}

// findCardByTitle returns the card in pod that title resolves to, or nil.
// Matching goes through titleLc, so it is case-insensitive like every
// other title lookup. Soft-deleted cards are ignored.
func findCardByTitle(app core.App, pod, title string) (*core.Record, error) {
	titleLc := slug.ToLowerKey(titleBase(TitleCandidate(title)))
	card, err := findLiveCardByTitleLc(app, pod, titleLc, "")
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return card, err
}

// createImportedCard saves a new "cards" record, mirroring createCardHandler.
// Its preview (description and image) is derived from text and stored right
// away, so syncDerived does not have to write the record a second time.
func createImportedCard(app core.App, pod, title, text string) (*core.Record, error) {
	// Cached: the lookup would otherwise re-read and re-parse the schema for
	// every imported page.
	collection, err := app.FindCachedCollectionByNameOrId("cards")
	if err != nil {
		return nil, fmt.Errorf("load cards collection: %w", err)
	}
	resolved, err := resolveTitle(app, pod, TitleCandidate(title), "")
	if err != nil {
		return nil, fmt.Errorf("resolve title: %w", err)
	}

	description, image, err := previewFields(app, text)
	if err != nil {
		return nil, fmt.Errorf("make preview: %w", err)
	}

	record := core.NewRecord(collection)
	record.Set("pod", pod)
	record.Set("title", string(resolved))
	record.Set("titleLc", slug.ToLowerKey(string(resolved)))
	record.Set("description", description)
	record.Set("image", image)
	if err := app.Save(record); err != nil {
		return nil, fmt.Errorf("save card: %w", err)
	}
	return record, nil
}
