package serve

import (
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpod/internal/attachment"
)

// newAttachmentTestApp extends newLinksTestApp with the "files" and
// "pod_files" collections. The relation fields are plain text here, like the
// other test helpers.
func newAttachmentTestApp(t *testing.T) core.App {
	t.Helper()
	app := newLinksTestApp(t)

	files := core.NewBaseCollection("files")
	files.Fields.Add(
		&core.FileField{Name: "file", MaxSelect: 1},
		&core.NumberField{Name: "filesize"},
		&core.TextField{Name: "hash"},
	)
	if err := app.Save(files); err != nil {
		t.Fatalf("create files collection: %v", err)
	}

	podFiles := core.NewBaseCollection("pod_files")
	podFiles.Fields.Add(
		&core.TextField{Name: "pod"},
		&core.TextField{Name: "file"},
		&core.TextField{Name: "filename"},
	)
	if err := app.Save(podFiles); err != nil {
		t.Fatalf("create pod_files collection: %v", err)
	}
	return app
}

func store(t *testing.T, app core.App, pod, content string) string {
	t.Helper()
	name, err := storeAttachment(app, pod, attachment.Result{Data: []byte(content), Ext: ".png"})
	if err != nil {
		t.Fatalf("storeAttachment: %v", err)
	}
	return name
}

func count(t *testing.T, app core.App, collection string) int64 {
	t.Helper()
	n, err := app.CountRecords(collection)
	if err != nil {
		t.Fatalf("count %s: %v", collection, err)
	}
	return n
}

func TestStoreAttachment_SameContentInTheSamePodKeepsItsName(t *testing.T) {
	app := newAttachmentTestApp(t)

	first := store(t, app, "pod1", "bytes")
	second := store(t, app, "pod1", "bytes")

	if first != second {
		t.Errorf("names = %q, %q; want the same", first, second)
	}
	if !strings.HasSuffix(first, ".png") || len(first) != 26+len(".png") {
		t.Errorf("name = %q, want a ULID followed by .png", first)
	}
	if count(t, app, "files") != 1 || count(t, app, "pod_files") != 1 {
		t.Error("want 1 file and 1 pod_files row")
	}
}

func TestStoreAttachment_SameContentInAnotherPodSharesTheFile(t *testing.T) {
	app := newAttachmentTestApp(t)

	first := store(t, app, "pod1", "bytes")
	second := store(t, app, "pod2", "bytes")

	if first == second {
		t.Errorf("both pods got the name %q, want a new one for the second", first)
	}
	if count(t, app, "files") != 1 || count(t, app, "pod_files") != 2 {
		t.Error("want 1 stored file shared by 2 pod_files rows")
	}
}

func TestStoreAttachment_DifferentContentIsStoredSeparately(t *testing.T) {
	app := newAttachmentTestApp(t)

	store(t, app, "pod1", "one")
	store(t, app, "pod1", "two")

	if count(t, app, "files") != 2 || count(t, app, "pod_files") != 2 {
		t.Error("want 2 files and 2 pod_files rows")
	}
}
