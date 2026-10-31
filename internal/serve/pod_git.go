// pod_git.go serves the Git remote settings of a pod. The remote lives in the
// pod repository's own .git/config (see internal/podrepo), which is the only
// place it is stored. The password is never sent back to the client.
package serve

import (
	"errors"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/aspen/internal/api"
	"github.com/asano69/aspen/internal/podrepo"
)

// podRepoPath returns the repository folder of the live pod named name.
func podRepoPath(app core.App, name string) (string, error) {
	pod, err := findImportPod(app, name)
	if err != nil {
		return "", err
	}
	return filepath.Join(app.DataDir(), podRepoDir, pod.GetString("name")), nil
}

func gitSettings(r podrepo.Remote) api.GitSettings {
	return api.GitSettings{URL: r.URL, Username: r.Username, HasPassword: r.Password != ""}
}

// gitSettingsHandler serves GET /api/admin/pods/{name}/git.
func gitSettingsHandler(e *core.RequestEvent) error {
	dir, err := podRepoPath(e.App, e.Request.PathValue("name"))
	if errors.Is(err, errPodNotFound) {
		return e.NotFoundError("pod not found", nil)
	}
	if err != nil {
		return e.InternalServerError("find pod", err)
	}
	remote, err := podrepo.GetRemote(dir)
	if err != nil {
		return e.InternalServerError("read the Git remote", err)
	}
	return e.JSON(http.StatusOK, gitSettings(remote))
}

// updateGitSettingsHandler serves PUT /api/admin/pods/{name}/git. An empty
// password keeps the stored one; an empty URL removes the remote.
func updateGitSettingsHandler(e *core.RequestEvent) error {
	var req api.GitSettingsRequest
	if err := e.BindBody(&req); err != nil {
		return e.BadRequestError("invalid request body", err)
	}
	dir, err := podRepoPath(e.App, e.Request.PathValue("name"))
	if errors.Is(err, errPodNotFound) {
		return e.NotFoundError("pod not found", nil)
	}
	if err != nil {
		return e.InternalServerError("find pod", err)
	}

	current, err := podrepo.GetRemote(dir)
	if err != nil {
		return e.InternalServerError("read the Git remote", err)
	}
	next := podrepo.Remote{
		URL:      strings.TrimSpace(req.URL),
		Username: strings.TrimSpace(req.Username),
		Password: req.Password,
	}
	if next.Password == "" {
		next.Password = current.Password
	}

	err = podrepo.SetRemote(dir, next)
	if errors.Is(err, podrepo.ErrInvalidURL) {
		return e.BadRequestError(err.Error(), nil)
	}
	if err != nil {
		return e.InternalServerError("save the Git remote", err)
	}
	if next.URL == "" {
		next = podrepo.Remote{}
	}
	return e.JSON(http.StatusOK, gitSettings(next))
}
