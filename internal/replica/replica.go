// Package replica lists the collections that are replicated to the frontend.
// A collection registered here gets, without any further code:
//   - a pull route (see internal/serve/replication.go)
//   - a realtime channel named after it that carries every create, update
//     and delete (see internal/realtime)
//
// A replicated collection needs an autodate "updated" field, a "deleted"
// date field (records are removed by soft delete, so that a pull can report
// the removal to a client that was offline) and, unless it is global, a field
// holding the id of the pod a record belongs to.
package replica

// Collection describes one replicated collection.
type Collection struct {
	// Name is the PocketBase collection name. It is also the segment of the
	// pull URL and the name of the realtime channel.
	Name string
	// PodField is the field holding the id of the pod a record belongs to. A
	// pull returns the records of a single pod. Empty for a global collection
	// (e.g. pods), which is not scoped to a pod: a pull returns every record.
	PodField string
}

// Collections is every replicated collection. Adding a line here is the whole
// backend side of replicating a new collection.
var Collections = []Collection{
	{Name: "cards", PodField: "pod"},
	{Name: "card_links", PodField: "target_pod"},
	{Name: "pods"},
}

// Find returns the replicated collection with the given name.
func Find(name string) (Collection, bool) {
	for _, c := range Collections {
		if c.Name == name {
			return c, true
		}
	}
	return Collection{}, false
}
