package podrepo

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestRemote(t *testing.T) {
	dir := t.TempDir()
	if r, err := GetRemote(dir); err != nil || r != (Remote{}) {
		t.Fatalf("GetRemote without a repository = (%+v, %v), want zero", r, err)
	}

	want := Remote{URL: "https://example.com/me/pod.git", Username: "bob", Password: "p@ss/word"}
	if err := SetRemote(dir, want); err != nil {
		t.Fatalf("SetRemote: %v", err)
	}
	if got, err := GetRemote(dir); err != nil || got != want {
		t.Errorf("GetRemote = (%+v, %v), want %+v", got, err, want)
	}

	if err := SetRemote(dir, Remote{URL: "ftp://example.com/x"}); !errors.Is(err, ErrInvalidURL) {
		t.Errorf("SetRemote(ftp) = %v, want ErrInvalidURL", err)
	}

	if err := SetRemote(dir, Remote{}); err != nil {
		t.Fatalf("SetRemote(empty): %v", err)
	}
	if got, _ := GetRemote(dir); got != (Remote{}) {
		t.Errorf("GetRemote after removal = %+v, want zero", got)
	}
}

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
