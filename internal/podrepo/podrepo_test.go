package podrepo

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCommit(t *testing.T) {
	dir := t.TempDir()
	if _, ok := LastCommitTime(dir); ok {
		t.Error("LastCommitTime reported a commit before any was made")
	}

	file := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(file, []byte("one"), 0o644); err != nil {
		t.Fatal(err)
	}
	if changed, err := Commit(dir, "first"); err != nil || !changed {
		t.Fatalf("first Commit = (%v, %v), want (true, nil)", changed, err)
	}
	if _, ok := LastCommitTime(dir); !ok {
		t.Error("LastCommitTime found no commit after Commit")
	}

	if changed, err := Commit(dir, "again"); err != nil || changed {
		t.Errorf("Commit without changes = (%v, %v), want (false, nil)", changed, err)
	}

	// A deleted file is a change too.
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if changed, err := Commit(dir, "delete"); err != nil || !changed {
		t.Errorf("Commit after a deletion = (%v, %v), want (true, nil)", changed, err)
	}
}
