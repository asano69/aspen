// Package podrepo keeps a Git repository inside a pod's export folder. It is
// the only package that imports go-git, so the rest of the app never sees its
// types. The repository is derived data: the database stays the source of
// truth, and the folder can always be rewritten from it.
//
// The remote ("origin") lives in the repository's own .git/config, including
// the credentials, which are stored in the URL's user info like Gitea does.
package podrepo

import (
	"errors"
	"fmt"
	"net/url"
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

	remoteName = "origin"
)

// ErrInvalidURL is returned (wrapped) by SetRemote for a URL that cannot be
// used as a remote. Test for it with errors.Is.
var ErrInvalidURL = errors.New("invalid remote URL")

// Remote is the remote a pod is pushed to. The zero value means no remote.
type Remote struct {
	URL      string // without credentials
	Username string
	Password string
}

// openOrInit opens the repository in dir, creating it on first use.
func openOrInit(dir string) (*git.Repository, error) {
	repo, err := git.PlainOpen(dir)
	if errors.Is(err, git.ErrRepositoryNotExists) {
		repo, err = git.PlainInit(dir, false)
	}
	if err != nil {
		return nil, fmt.Errorf("open repository %s: %w", dir, err)
	}
	return repo, nil
}

// Commit stages every change in dir (additions, edits and deletions) and
// commits it. The repository is created on first use. It reports false when
// nothing changed, in which case no commit is made.
func Commit(dir, message string) (bool, error) {
	repo, err := openOrInit(dir)
	if err != nil {
		return false, err
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

// GetRemote reads the remote from the repository's config. A missing
// repository or remote gives the zero Remote.
func GetRemote(dir string) (Remote, error) {
	repo, err := git.PlainOpen(dir)
	if errors.Is(err, git.ErrRepositoryNotExists) {
		return Remote{}, nil
	}
	if err != nil {
		return Remote{}, fmt.Errorf("open repository %s: %w", dir, err)
	}
	cfg, err := repo.Config()
	if err != nil {
		return Remote{}, fmt.Errorf("read config of %s: %w", dir, err)
	}
	rc := cfg.Remotes[remoteName]
	if rc == nil || len(rc.URLs) == 0 {
		return Remote{}, nil
	}

	u, err := url.Parse(rc.URLs[0])
	if err != nil {
		return Remote{}, fmt.Errorf("parse remote URL of %s: %w", dir, err)
	}
	var r Remote
	if u.User != nil {
		r.Username = u.User.Username()
		r.Password, _ = u.User.Password()
		u.User = nil
	}
	r.URL = u.String()
	return r, nil
}

// SetRemote writes the remote to the repository's config, creating the
// repository on first use. An empty URL removes the remote.
func SetRemote(dir string, r Remote) error {
	var stored string
	if r.URL != "" {
		u, err := url.Parse(r.URL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return fmt.Errorf("%w: %q must be an http(s) URL", ErrInvalidURL, r.URL)
		}
		switch {
		case r.Username != "" && r.Password != "":
			u.User = url.UserPassword(r.Username, r.Password)
		case r.Username != "":
			u.User = url.User(r.Username)
		}
		stored = u.String()
	}

	repo, err := openOrInit(dir)
	if err != nil {
		return err
	}
	cfg, err := repo.Config()
	if err != nil {
		return fmt.Errorf("read config of %s: %w", dir, err)
	}
	if stored == "" {
		delete(cfg.Remotes, remoteName)
	} else {
		cfg.Remotes[remoteName] = &config.RemoteConfig{Name: remoteName, URLs: []string{stored}}
	}
	if err := repo.SetConfig(cfg); err != nil {
		return fmt.Errorf("write config of %s: %w", dir, err)
	}
	return nil
}

// Push sends the current branch of the repository in dir to its remote. It
// does nothing when no remote is set. History is never rewritten, so no force
// push is needed. Being already up to date is not an error.
func Push(dir string) error {
	r, err := GetRemote(dir)
	if err != nil || r.URL == "" {
		return err
	}
	repo, err := git.PlainOpen(dir)
	if err != nil {
		return fmt.Errorf("open repository %s: %w", dir, err)
	}
	head, err := repo.Head()
	if err != nil {
		return fmt.Errorf("repository %s has no commit to push: %w", dir, err)
	}

	// The URL is passed without credentials, so errors never contain them.
	opts := &git.PushOptions{RemoteURL: r.URL}
	branch := head.Name().String()
	opts.RefSpecs = []config.RefSpec{config.RefSpec(branch + ":" + branch)}
	if r.Username != "" {
		opts.Auth = &http.BasicAuth{Username: r.Username, Password: r.Password}
	}
	err = repo.Push(opts)
	if err != nil && !errors.Is(err, git.NoErrAlreadyUpToDate) {
		return fmt.Errorf("push %s to %s: %w", dir, r.URL, err)
	}
	return nil
}
