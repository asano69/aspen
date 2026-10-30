// Package podrepo keeps a Git repository inside a pod's export folder. It is
// the only package that imports go-git, so the rest of the app never sees its
// types. The repository is derived data: the database stays the source of
// truth, and the folder can always be rewritten from it.
package podrepo

import (
	"errors"
	"fmt"
	"time"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing/object"
	"github.com/go-git/go-git/v5/plumbing/transport/http"
)

// Every commit has this fixed author. Who wrote each line is already kept,
// signed, in the lines of card_contents.
const (
	authorName  = "aspen"
	authorEmail = "aspen@localhost"
)

// Commit stages every change in dir (additions, edits and deletions) and
// commits it. The repository is created on first use. It reports false when
// nothing changed, in which case no commit is made.
func Commit(dir, message string) (bool, error) {
	repo, err := git.PlainOpen(dir)
	if errors.Is(err, git.ErrRepositoryNotExists) {
		repo, err = git.PlainInit(dir, false)
	}
	if err != nil {
		return false, fmt.Errorf("open repository %s: %w", dir, err)
	}
	wt, err := repo.Worktree()
	if err != nil {
		return false, fmt.Errorf("open work tree of %s: %w", dir, err)
	}
	if err := wt.AddWithOptions(&git.AddOptions{All: true}); err != nil {
		return false, fmt.Errorf("stage changes in %s: %w", dir, err)
	}
	status, err := wt.Status()
	if err != nil {
		return false, fmt.Errorf("read status of %s: %w", dir, err)
	}
	if status.IsClean() {
		return false, nil
	}

	sig := &object.Signature{Name: authorName, Email: authorEmail, When: time.Now()}
	if _, err := wt.Commit(message, &git.CommitOptions{Author: sig, Committer: sig}); err != nil {
		return false, fmt.Errorf("commit in %s: %w", dir, err)
	}
	return true, nil
}

// LastCommitTime returns the time of the newest commit of the repository in
// dir. ok is false when there is no repository or it has no commit yet.
func LastCommitTime(dir string) (t time.Time, ok bool) {
	repo, err := git.PlainOpen(dir)
	if err != nil {
		return time.Time{}, false
	}
	head, err := repo.Head()
	if err != nil {
		return time.Time{}, false
	}
	commit, err := repo.CommitObject(head.Hash())
	if err != nil {
		return time.Time{}, false
	}
	return commit.Committer.When, true
}

// Push sends the current branch of the repository in dir to the remote url,
// authenticating with token. History is never rewritten, so no force push is
// needed. Being already up to date is not an error.
func Push(dir, url, token string) error {
	repo, err := git.PlainOpen(dir)
	if err != nil {
		return fmt.Errorf("open repository %s: %w", dir, err)
	}
	head, err := repo.Head()
	if err != nil {
		return fmt.Errorf("repository %s has no commit to push: %w", dir, err)
	}
	branch := head.Name().String()
	err = repo.Push(&git.PushOptions{
		RemoteURL: url,
		RefSpecs:  []config.RefSpec{config.RefSpec(branch + ":" + branch)},
		Auth:      &http.BasicAuth{Username: "git", Password: token},
	})
	if err != nil && !errors.Is(err, git.NoErrAlreadyUpToDate) {
		return fmt.Errorf("push %s to %s: %w", dir, url, err)
	}
	return nil
}
