// internal/serve/ydoc_test.go
package serve

import (
	"encoding/json"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

func TestBuildPreview_JoinsLinesExcludingFirst(t *testing.T) {
	// The first line is the title, so it's excluded from the
	// description automatically.
	text := "Title\nfirst line\nsecond line"
	got := buildPreview(text)
	want := "first line\nsecond line"
	if got != want {
		t.Errorf("buildPreview(...) = %q, want %q", got, want)
	}
}

func TestBuildPreview_SkipsBlankLines(t *testing.T) {
	text := "Title\n   \nreal text"
	got := buildPreview(text)
	want := "real text"
	if got != want {
		t.Errorf("buildPreview(...) = %q, want %q", got, want)
	}
}

func TestBuildPreview_NoBodyLines_EmptyString(t *testing.T) {
	text := "Title only"
	got := buildPreview(text)
	if got != "" {
		t.Errorf("buildPreview(...) = %q, want empty", got)
	}
}

func TestBuildPreview_CodeBlockKeepsPositionAndQuotesLines(t *testing.T) {
	text := "Title\nbefore\ncode:go\n\tx := 1\n\t   \n\treturn\nafter"
	got := buildPreview(text)
	want := "before\n`x := 1`\n`return`\nafter"
	if got != want {
		t.Errorf("buildPreview(...) = %q, want %q", got, want)
	}
}

func TestDescriptionLines(t *testing.T) {
	if got := descriptionLines("Title\na\nb"); len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Errorf("descriptionLines = %q, want [a b]", got)
	}
	// An empty preview is an empty list, not nil (which would encode as null).
	if got := descriptionLines("Title only"); got == nil || len(got) != 0 {
		t.Errorf("descriptionLines = %#v, want an empty non-nil slice", got)
	}
}

func TestBuildPreview_EmptyText_EmptyString(t *testing.T) {
	got := buildPreview("")
	if got != "" {
		t.Errorf(`buildPreview("") = %q, want empty`, got)
	}
}

func TestUpdatePreview_UpdatesDescriptionAndFirstImage(t *testing.T) {
	app := newSlugTestApp(t)
	cards, err := app.FindCollectionByNameOrId("cards")
	if err != nil {
		t.Fatalf("find cards collection: %v", err)
	}
	// Same type as production: "description" is a JSON field.
	cards.Fields.Add(&core.JSONField{Name: "description"}, &core.TextField{Name: "image"})
	if err := app.Save(cards); err != nil {
		t.Fatalf("add preview fields: %v", err)
	}

	record := createCard(t, app, "pot1", "Title")
	persistence := &ydocPersistence{app: app}
	text := "Title\n`[https://example.com/hidden.png]`\n[https://example.com/first.png]\n[https://example.com/later.jpg]"
	if err := persistence.updatePreview(record.Id, text); err != nil {
		t.Fatalf("updatePreview: %v", err)
	}

	updated, err := app.FindRecordById("cards", record.Id)
	if err != nil {
		t.Fatalf("reload card: %v", err)
	}
	wantLines, _ := json.Marshal([]string{
		"`[https://example.com/hidden.png]`",
		"[https://example.com/first.png]",
		"[https://example.com/later.jpg]",
	})
	if got, want := updated.GetString("description"), string(wantLines); got != want {
		t.Errorf("description = %q, want %q", got, want)
	}

	// Saving the same text again must not touch the record.
	before := updated.GetDateTime("updated")
	if err := persistence.updatePreview(record.Id, text); err != nil {
		t.Fatalf("updatePreview (again): %v", err)
	}
	again, err := app.FindRecordById("cards", record.Id)
	if err != nil {
		t.Fatalf("reload card: %v", err)
	}
	if !again.GetDateTime("updated").Equal(before) {
		t.Error("an unchanged description was saved again")
	}
	if got, want := updated.GetString("image"), "https://example.com/first.png"; got != want {
		t.Errorf("image = %q, want %q", got, want)
	}
}
