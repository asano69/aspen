// replication.go implements the pull side of the replication protocol that
// the frontend's Dexie database uses to fill its local copy of every
// collection registered in internal/replica (see docs/dexie-offline-sync.md).
// Only reads happen here: writes still go straight through PocketBase's own
// REST API.
package serve

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpod/internal/replica"
)

const (
	// defaultPullLimit is used when the client sends no "limit".
	defaultPullLimit = 200
	// maxPullLimit caps "limit". It must stay >= the frontend's Dexie
	// batch size: a page shorter than that tells Dexie there is
	// nothing left to pull.
	maxPullLimit = 1000
)

// checkpoint is the position a pull continues after. Both fields are
// needed because several records can share one "updated" value; the id
// breaks that tie.
type checkpoint struct {
	UpdatedAt string // the record's "updated" value, exactly as PocketBase returned it
	ID        string
}

// parsePullQuery reads the checkpoint and limit of a pull request. A nil
// checkpoint means "from the beginning".
func parsePullQuery(q url.Values) (*checkpoint, int, error) {
	limit := defaultPullLimit
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > maxPullLimit {
			return nil, 0, fmt.Errorf("limit must be an integer between 1 and %d", maxPullLimit)
		}
		limit = n
	}

	updatedAt, id := q.Get("updatedAt"), q.Get("id")
	if (updatedAt == "") != (id == "") {
		return nil, 0, errors.New("updatedAt and id must be given together")
	}
	if updatedAt == "" {
		return nil, limit, nil
	}
	return &checkpoint{UpdatedAt: updatedAt, ID: id}, limit, nil
}

// pullRecords returns the records of a pot (of the whole collection, when it
// is global) that changed after the checkpoint, oldest first, at most limit of
// them. Soft-deleted records are included on purpose: the local replica needs
// them as deletion events.
func pullRecords(app core.App, c replica.Collection, potID string, after *checkpoint, limit int) ([]*core.Record, error) {
	var clauses []string
	params := dbx.Params{}
	if c.PotField != "" {
		clauses = append(clauses, c.PotField+" = {:pot}")
		params["pot"] = potID
	}
	if after != nil {
		clauses = append(clauses, "(updated > {:updatedAt} || (updated = {:updatedAt} && id > {:id}))")
		params["updatedAt"] = after.UpdatedAt
		params["id"] = after.ID
	}
	return app.FindRecordsByFilter(c.Name, strings.Join(clauses, " && "), "updated,id", limit, 0, params)
}

// pullHandler serves GET /api/pages/{potId}/<collection>/pull, or
// GET /api/pages/<collection>/pull for a global collection.
func pullHandler(c replica.Collection) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		after, limit, err := parsePullQuery(e.Request.URL.Query())
		if err != nil {
			return e.BadRequestError(err.Error(), nil)
		}

		records, err := pullRecords(e.App, c, e.Request.PathValue("potId"), after, limit)
		if err != nil {
			return e.InternalServerError("pull "+c.Name, err)
		}
		if records == nil {
			records = []*core.Record{} // encode "no changes" as [], not null
		}
		return e.JSON(http.StatusOK, map[string]any{"records": records})
	}
}
