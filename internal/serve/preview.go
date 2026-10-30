// preview.go derives a card's "description" and "image" fields from its text.
package serve

import (
	"encoding/json"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/asano69/aspen/internal/parser"
)

// updatePreview refreshes a card's derived description and image fields from
// its text. "title" is resolved elsewhere (see title_watch.go), not here.
func updatePreview(app core.App, room, text string) error {
	record, err := app.FindRecordById("cards", room)
	if err != nil {
		return nil // card may have been deleted concurrently -- skip
	}

	description, image, err := previewFields(app, text)
	if err != nil {
		return err
	}
	// GetString on a JSON field returns its raw JSON text, so it is compared
	// with the JSON text that is about to be stored.
	if record.GetString("description") == string(description) && record.GetString("image") == image {
		return nil // unchanged -- avoid a no-op write and its "updated" bump
	}
	record.Set("description", description)
	record.Set("image", image)
	return app.Save(record)
}

// previewFields computes the values of a card's derived "description" and
// "image" fields from its text. It is shared by updatePreview and by the
// importer, which stores them together with the new card record.
func previewFields(app core.App, text string) (types.JSONRaw, string, error) {
	description, err := json.Marshal(descriptionLines(text))
	if err != nil {
		return nil, "", err
	}
	return types.JSONRaw(description), thumbnailSrc(app, parser.Parse(text)), nil
}

// descriptionLines is the value of a card's "description" JSON field: the
// preview text split into lines. An empty preview is an empty list (never
// nil, which would be stored as JSON null).
func descriptionLines(text string) []string {
	preview := buildPreview(text)
	if preview == "" {
		return []string{}
	}
	return strings.Split(preview, "\n")
}

// descriptionMaxRunes caps how much text buildPreview keeps, counted
// in runes (not bytes) so a card written in Japanese isn't cut
// mid-character.
const descriptionMaxRunes = 120

// buildPreview turns a card's full plain-text content into a short
// description: every non-blank line after the first (the title),
// joined by a newline and cut to descriptionMaxRunes runes.
//
// A code: block is shown without its declaration line, and each of its
// body lines is wrapped in backticks. The rewrite happens in place, so
// the block keeps its position among the other lines.
func buildPreview(text string) string {
	lines := strings.Split(text, "\n")
	for _, node := range parser.Parse(text).Nodes {
		if node.Kind != parser.KindCodeBlock {
			continue
		}
		lines[node.StartLine] = "" // the declaration is dropped
		for i, body := range node.Body {
			lines[node.StartLine+1+i] = quoteCodeLine(body)
		}
	}
	if len(lines) > 0 {
		lines = lines[1:] // drop the title line
	}

	var body []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			body = append(body, trimmed)
		}
	}
	return truncateRunes(strings.Join(body, "\n"), descriptionMaxRunes)
}

// quoteCodeLine wraps one code line in backticks. A line with nothing but
// whitespace becomes empty, so it is skipped like any other blank line.
func quoteCodeLine(line string) string {
	if strings.TrimSpace(line) == "" {
		return ""
	}
	return "`" + line + "`"
}

// truncateRunes cuts s to at most max runes (not bytes), so a card
// written in Japanese isn't cut mid-character.
func truncateRunes(s string, max int) string {
	runes := []rune(s)
	if len(runes) > max {
		runes = runes[:max]
	}
	return string(runes)
}
