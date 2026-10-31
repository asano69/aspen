// pod_repos.go gives every pod a Git repository, so its history is kept and it
// can be mirrored to a remote. The repository is the pod's export folder
// (see export.go) under <data dir>/git/<pod name>, committed as a whole.
//
// Saving a card happens about a second after each edit, so committing every
// time would flood the history. Instead every change (re)starts a per-pod
// timer, and the pod is committed once it has been quiet for podRepoQuietDelay.
// Pending commits are also made when the server stops. After a restart the
// pods that changed since their last commit are found by comparing "updated"
// times with the time of the newest commit, so no state is stored.
//
// The pod is exported again in full on every commit, so a card renamed or
// deleted simply disappears from the work tree and Git records it. The
// database remains the source of truth: the repository can be deleted and
// rebuilt, but a rebuilt history differs from what a mirror already holds.
//
// A pod is mirrored (pushed) after each commit when its repository has a
// remote (see pod_git.go, which edits it from the pod settings). A failed push
// is only logged and retried after the next commit.
package serve

import (
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/asano69/aspen/internal/podrepo"
)

const (
	podRepoDir        = "git"
	podRepoQuietDelay = 5 * time.Minute
)

type podRepos struct {
	app  core.App
	root string // <data dir>/git

	// commitMu makes commits run one at a time.
	commitMu sync.Mutex

	// timerMu guards timers, the pending commit of each pod by pod id.
	timerMu sync.Mutex
	timers  map[string]*time.Timer
}

// startPodRepos is bound to OnServe (see serve.go).
func startPodRepos(e *core.ServeEvent) error {
	r := &podRepos{
		app:    e.App,
		root:   filepath.Join(e.App.DataDir(), podRepoDir),
		timers: map[string]*time.Timer{},
	}
	r.bindHooks()
	// Bound after the rooms' own flush (see registerRoutes), so the last edits
	// are stored before the pending commits are made.
	e.App.OnTerminate().BindFunc(func(te *core.TerminateEvent) error {
		r.flush()
		return te.Next()
	})
	go r.markStale()
	return e.Next()
}

// bindHooks marks a pod dirty whenever one of its cards or texts changes, and
// drops the repository of a deleted pod.
func (r *podRepos) bindHooks() {
	touch := func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		r.mark(e.Record.GetString("pod"))
		return nil
	}
	for _, name := range []string{"cards", "card_contents"} {
		r.app.OnRecordAfterCreateSuccess(name).BindFunc(touch)
		r.app.OnRecordAfterUpdateSuccess(name).BindFunc(touch)
		r.app.OnRecordAfterDeleteSuccess(name).BindFunc(touch)
	}

	// A pod's own title and cover are part of the export.
	podChanged := func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if e.Record.GetDateTime("deleted").IsZero() {
			r.mark(e.Record.Id)
		} else {
			r.remove(e.Record)
		}
		return nil
	}
	r.app.OnRecordAfterCreateSuccess("pods").BindFunc(podChanged)
	r.app.OnRecordAfterUpdateSuccess("pods").BindFunc(podChanged)
	r.app.OnRecordAfterDeleteSuccess("pods").BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		r.remove(e.Record)
		return nil
	})
}

// mark schedules a commit of the pod, or postpones the one already scheduled.
func (r *podRepos) mark(podID string) {
	if podID == "" {
		return
	}
	r.timerMu.Lock()
	defer r.timerMu.Unlock()
	if t, ok := r.timers[podID]; ok {
		t.Reset(podRepoQuietDelay)
		return
	}
	r.timers[podID] = time.AfterFunc(podRepoQuietDelay, func() {
		r.timerMu.Lock()
		delete(r.timers, podID)
		r.timerMu.Unlock()
		r.commit(podID)
	})
}

// remove cancels the pending commit of a deleted pod and deletes its
// repository.
func (r *podRepos) remove(pod *core.Record) {
	r.timerMu.Lock()
	if t, ok := r.timers[pod.Id]; ok {
		t.Stop()
		delete(r.timers, pod.Id)
	}
	r.timerMu.Unlock()

	// A pod name is letters, digits and hyphens, so it cannot leave r.root.
	if name := pod.GetString("name"); name != "" {
		if err := os.RemoveAll(filepath.Join(r.root, name)); err != nil {
			slog.Warn("remove pod repository", "pod", name, "error", err)
		}
	}
}

// flush makes every pending commit at once. Called when the server stops.
func (r *podRepos) flush() {
	r.timerMu.Lock()
	pending := make([]string, 0, len(r.timers))
	for id, t := range r.timers {
		t.Stop()
		pending = append(pending, id)
	}
	clear(r.timers)
	r.timerMu.Unlock()

	for _, id := range pending {
		r.commit(id)
	}
}

// updatedRow is the newest "updated" of one pod.
type updatedRow struct {
	Pod     string `db:"pod"`
	Updated string `db:"updated"`
}

// markStale schedules a commit for every pod that changed since its newest
// commit, or has no repository yet.
func (r *podRepos) markStale() {
	var rows []updatedRow
	err := r.app.DB().NewQuery(`
		SELECT pod, MAX(updated) AS updated FROM (
			SELECT pod, updated FROM cards
			UNION ALL SELECT pod, updated FROM card_contents
			UNION ALL SELECT id AS pod, updated FROM pods
		) GROUP BY pod`).All(&rows)
	if err != nil {
		slog.Warn("find pods without a recent commit", "error", err)
		return
	}
	for _, row := range rows {
		pod, err := r.app.FindRecordById("pods", row.Pod)
		if err != nil || !pod.GetDateTime("deleted").IsZero() {
			continue
		}
		updated, err := types.ParseDateTime(row.Updated)
		if err != nil {
			continue
		}
		last, ok := podrepo.LastCommitTime(filepath.Join(r.root, pod.GetString("name")))
		if !ok || updated.Time().After(last) {
			r.mark(pod.Id)
		}
	}
}

// commit writes the pod's export into its repository and commits it, then
// pushes it to the mirror, if there is one. Failures are only logged: they
// must never affect editing, and the next change tries again.
func (r *podRepos) commit(podID string) {
	r.commitMu.Lock()
	defer r.commitMu.Unlock()

	pod, err := r.app.FindRecordById("pods", podID)
	if err != nil || !pod.GetDateTime("deleted").IsZero() {
		return // deleted meanwhile: nothing to keep
	}
	name := pod.GetString("name")
	dir := filepath.Join(r.root, name)

	if err := clearExport(dir); err != nil {
		slog.Warn("clear pod repository", "pod", name, "error", err)
		return
	}
	if _, err := Export(r.app, name, r.root); err != nil {
		slog.Warn("export pod to its repository", "pod", name, "error", err)
		return
	}
	if _, err := podrepo.Commit(dir, "Update "+pod.GetString("title")); err != nil {
		slog.Warn("commit pod", "pod", name, "error", err)
		return
	}
	if err := podrepo.Push(dir); err != nil {
		slog.Warn("push pod to its mirror", "pod", name, "error", err)
	}
}

// clearExport removes what a previous export wrote (and keeps .git), so cards
// that no longer exist are not left behind.
func clearExport(dir string) error {
	for _, name := range []string{manifestName, "cards", "files", "cover"} {
		if err := os.RemoveAll(filepath.Join(dir, name)); err != nil {
			return err
		}
	}
	return nil
}

