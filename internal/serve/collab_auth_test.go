package serve

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	// Registers PocketBase's system migrations (creates _superusers etc.),
	// which Bootstrap needs.
	_ "github.com/pocketbase/pocketbase/migrations"
)

func newSuperuserToken(t *testing.T, app core.App) string {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatalf("find superusers collection: %v", err)
	}
	record := core.NewRecord(collection)
	record.SetEmail("admin@example.com")
	record.SetPassword("password123")
	if err := app.Save(record); err != nil {
		t.Fatalf("save superuser: %v", err)
	}
	token, err := record.NewAuthToken()
	if err != nil {
		t.Fatalf("new auth token: %v", err)
	}
	return token
}

// collabAuthStatus sends one request through collabAuth and returns the status and
// whether the protected handler was reached.
func collabAuthStatus(t *testing.T, app core.App, room, token string) (status int, reached bool) {
	t.Helper()
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached = true
		w.WriteHeader(http.StatusNoContent)
	})
	req := httptest.NewRequest(http.MethodGet, "/collab/"+room+"?token="+token, nil)
	req.SetPathValue("room", room)
	rec := httptest.NewRecorder()
	collabAuth(app, next).ServeHTTP(rec, req)
	return rec.Code, reached
}

func TestCollabAuth(t *testing.T) {
	app := newSlugTestApp(t)
	token := newSuperuserToken(t, app)
	live := createCard(t, app, "pot1", "A")
	deleted := createCard(t, app, "pot1", "B")
	softDelete(t, app, deleted)

	cases := []struct {
		name, room, token string
		status            int
		reached           bool
	}{
		{"valid token and card", live.Id, token, http.StatusNoContent, true},
		{"no token", live.Id, "", http.StatusUnauthorized, false},
		{"garbage token", live.Id, "not-a-token", http.StatusUnauthorized, false},
		{"unknown room", "missing", token, http.StatusNotFound, false},
		{"deleted card", deleted.Id, token, http.StatusNotFound, false},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			status, reached := collabAuthStatus(t, app, tt.room, tt.token)
			if status != tt.status || reached != tt.reached {
				t.Errorf("got (%d, reached=%v), want (%d, reached=%v)", status, reached, tt.status, tt.reached)
			}
		})
	}
}

// hijackableWriter hands out one end of a pipe as the hijacked connection.
type hijackableWriter struct {
	http.ResponseWriter
	conn net.Conn
}

func (w hijackableWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return w.conn, nil, nil
}

func TestExpiringWriter_ReportsCloseOnce(t *testing.T) {
	server, client := net.Pipe()
	defer client.Close()

	closed := 0
	w := expiringWriter{
		ResponseWriter: hijackableWriter{ResponseWriter: httptest.NewRecorder(), conn: server},
		expiresAt:      time.Now().Add(time.Hour),
		onClose:        func() { closed++ },
	}
	conn, _, err := w.Hijack()
	if err != nil {
		t.Fatalf("Hijack: %v", err)
	}
	_ = conn.Close()
	_ = conn.Close()

	if closed != 1 {
		t.Errorf("onClose ran %d times, want 1", closed)
	}
}

func TestExpiringWriter_ClosesTheHijackedConnectionAtExpiry(t *testing.T) {
	server, client := net.Pipe()
	defer client.Close()

	w := expiringWriter{
		ResponseWriter: hijackableWriter{ResponseWriter: httptest.NewRecorder(), conn: server},
		expiresAt:      time.Now().Add(50 * time.Millisecond),
	}
	if _, _, err := w.Hijack(); err != nil {
		t.Fatalf("Hijack: %v", err)
	}

	// The client end sees EOF once the server end is closed.
	_ = client.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := client.Read(make([]byte, 1)); err == nil || err.Error() == "i/o timeout" {
		t.Errorf("read err = %v, want the connection to be closed at expiry", err)
	}
}
