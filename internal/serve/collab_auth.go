// collab_auth.go protects the collab websocket. A browser WebSocket cannot send an
// Authorization header, so the PocketBase auth token comes in the "token"
// query parameter. Everything is checked before the upgrade, so a rejected
// client gets a plain HTTP status instead of an open socket.
package serve

import (
	"bufio"
	"context"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpod/internal/auth"
)

type userKey struct{}

// authorOf names who is behind a connection: the email address of the user
// whose token it was opened with. It is what the room's tracker receives as
// the author of an edit.
func authorOf(r *http.Request) any {
	if email, ok := r.Context().Value(userKey{}).(string); ok {
		return email
	}
	return nil
}

// collabAuth lets a request through to next only when its token is valid and the
// user may open the requested room.
func collabAuth(app core.App, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session, err := auth.Verify(app, r.URL.Query().Get("token"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}

		// The room name is a card id.
		err = auth.CanAccessCard(app, session.UserID, r.PathValue("room"))
		switch {
		case errors.Is(err, auth.ErrCardNotFound):
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		case err != nil:
			http.Error(w, "failed to check access to the card", http.StatusInternalServerError)
			return
		}

		// Superusers are not tracked: they are rarely used and can do
		// anything anyway.
		var onClose func()
		if !session.IsSuperuser {
			room := r.PathValue("room")
			recordCardView(app, session.UserID, room)
			onClose = func() { recordCardLeft(app, session.UserID, room) }
		}

		r = r.WithContext(context.WithValue(r.Context(), userKey{}, session.Email))
		next.ServeHTTP(expiringWriter{
			ResponseWriter: w,
			expiresAt:      session.ExpiresAt,
			onClose:        onClose,
		}, r)
	})
}

// expiringWriter makes the websocket connection that is hijacked from it close
// itself when the token it was opened with expires. The client reconnects with
// its refreshed token (see ExistingCardEditor.tsx).
type expiringWriter struct {
	http.ResponseWriter
	expiresAt time.Time
	// onClose, when set, runs once when the hijacked connection is closed
	// (the user left the room). It must not block.
	onClose func()
}

func (w expiringWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w expiringWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("response writer does not support hijacking")
	}
	conn, rw, err := hijacker.Hijack()
	if err != nil {
		return nil, nil, err
	}
	timer := time.AfterFunc(time.Until(w.expiresAt), func() { _ = conn.Close() })
	return &expiringConn{Conn: conn, timer: timer, onClose: w.onClose}, rw, nil
}

// expiringConn stops the expiry timer when the connection is closed first, so
// the timer does not keep a closed connection alive. It also reports the
// close (once) through onClose.
type expiringConn struct {
	net.Conn
	timer   *time.Timer
	onClose func()
	once    sync.Once
}

func (c *expiringConn) Close() error {
	c.timer.Stop()
	c.once.Do(func() {
		if c.onClose != nil {
			c.onClose()
		}
	})
	return c.Conn.Close()
}
