// validate.go rejects saving a record whose name/title is a reserved
// word, since such a value would collide with a static frontend route
// or API path segment. It also rejects a pod that links to itself. Every
// reserved-word list and its
// case-insensitive comparison rule live in internal/slug (see
// reserved.go there) -- this file only wires each collection/field
// pair to the matching check via registerReservedNameValidation.
package serve

import (
	"fmt"
	"slices"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	"github.com/asano69/cardpod/internal/slug"
)

// registerValidationHooks wires up every OnRecordValidate hook this
// package needs. Called once from Run (see serve.go).
func registerValidationHooks(app *pocketbase.PocketBase) {
	// "cards" titles must avoid the "/:slug/new" draft-creation route
	// (see frontend/src/lib/router.tsx).
	registerReservedNameValidation(app, "cards", "title", slug.IsReserved)
	// "pods" names must avoid top-level static routes and API path
	// segments (see frontend/src/lib/router.tsx and
	// internal/serve/handler.go's "/api/..." route groups).
	registerReservedNameValidation(app, "pods", "name", slug.IsReservedPodName)
	// A pod's "links" relation must never point back at the pod itself.
	app.OnRecordValidate("pods").BindFunc(func(e *core.RecordEvent) error {
		if slices.Contains(e.Record.GetStringSlice("links"), e.Record.Id) {
			return fmt.Errorf("a pod cannot link to itself")
		}
		return e.Next()
	})
}

// registerReservedNameValidation rejects saving a record in
// collection whose field's value is reserved according to isReserved.
// The comparison rule itself (case-insensitive exact match) lives in
// internal/slug; this only wires it up per collection/field.
func registerReservedNameValidation(
	app *pocketbase.PocketBase,
	collection, field string,
	isReserved func(string) bool,
) {
	app.OnRecordValidate(collection).BindFunc(func(e *core.RecordEvent) error {
		value := e.Record.GetString(field)
		if isReserved(value) {
			return fmt.Errorf("%s %q is reserved", field, value)
		}
		return e.Next()
	})
}
