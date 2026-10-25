// Package auth verifies the credentials of realtime connections (the Yjs
// websocket and the centrifuge hub) and decides what they may access. Both
// transports share this one place, so how a connection is authenticated and
// authorized never differs between them.
package auth

import (
	"database/sql"
	"errors"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
)

var (
	ErrInvalidToken = errors.New("invalid or expired auth token")
	ErrCardNotFound = errors.New("card not found")
)

// Session is a verified connection: who it belongs to and when its token
// stops being valid.
type Session struct {
	UserID    string
	Email     string
	ExpiresAt time.Time
	// IsSuperuser is true for a superuser, false for a regular user.
	IsSuperuser bool
}

// Verify accepts any valid PocketBase auth token (a regular user or a
// superuser).
func Verify(app core.App, token string) (Session, error) {
	record, err := app.FindAuthRecordByToken(token, core.TokenTypeAuth)
	if err != nil {
		return Session{}, ErrInvalidToken
	}
	// The signature was checked above, so the claims can be read as they are.
	claims, err := security.ParseUnverifiedJWT(token)
	if err != nil {
		return Session{}, ErrInvalidToken
	}
	exp, ok := claims["exp"].(float64)
	if !ok {
		return Session{}, ErrInvalidToken
	}
	return Session{
		UserID:      record.Id,
		Email:       record.Email(),
		ExpiresAt:   time.Unix(int64(exp), 0),
		IsSuperuser: record.Collection().Name == core.CollectionNameSuperusers,
	}, nil
}

// CanAccessCard reports whether the user may open the card's live room. It
// returns ErrCardNotFound for a card that does not exist or is deleted, so a
// room can never be created for an arbitrary name.
//
// Every authenticated user may access every card for now. Per-pod
// permissions will be decided here, and nowhere else.
func CanAccessCard(app core.App, userID, cardID string) error {
	card, err := app.FindRecordById("cards", cardID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrCardNotFound
	}
	if err != nil {
		return err
	}
	if !card.GetDateTime("deleted").IsZero() {
		return ErrCardNotFound
	}
	return nil
}
