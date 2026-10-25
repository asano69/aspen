// internal/realtime/register_test.go
package realtime

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	// Registers PocketBase's system migrations (creates _superusers etc.),
	// which Bootstrap needs.
	_ "github.com/pocketbase/pocketbase/migrations"
)

func newTestApp(t *testing.T) core.App {
	t.Helper()

	app := core.NewBaseApp(core.BaseAppConfig{DataDir: t.TempDir()})
	if err := app.Bootstrap(); err != nil {
		t.Fatalf("bootstrap app: %v", err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })

	cards := core.NewBaseCollection("cards")
	cards.Fields.Add(&core.TextField{Name: "pod"}, &core.TextField{Name: "title"})
	if err := app.Save(cards); err != nil {
		t.Fatalf("create cards collection: %v", err)
	}
	return app
}

type published struct {
	channel string
	data    []byte
}

// newTestHub returns a hub whose publications are captured instead of sent.
func newTestHub(app core.App, publishErr error) (*Hub, *[]published) {
	var got []published
	hub := &Hub{publish: func(channel string, data []byte) error {
		got = append(got, published{channel, data})
		return publishErr
	}}
	hub.BindHooks(app)
	return hub, &got
}

func saveCard(t *testing.T, app core.App, pod, title string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("cards")
	if err != nil {
		t.Fatalf("find cards collection: %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("pod", pod)
	record.Set("title", title)
	if err := app.Save(record); err != nil {
		t.Fatalf("save card: %v", err)
	}
	return record
}

func decode(t *testing.T, p published) (action, id string) {
	t.Helper()
	var event struct {
		Action string `json:"action"`
		Record struct {
			ID string `json:"id"`
		} `json:"record"`
	}
	if err := json.Unmarshal(p.data, &event); err != nil {
		t.Fatalf("decode payload %s: %v", p.data, err)
	}
	return event.Action, event.Record.ID
}

func TestCardHooks_PublishCreateUpdateDeleteToCardsChannel(t *testing.T) {
	app := newTestApp(t)
	_, got := newTestHub(app, nil)

	card := saveCard(t, app, "pod1", "A")
	card.Set("title", "B")
	if err := app.Save(card); err != nil {
		t.Fatalf("update card: %v", err)
	}
	if err := app.Delete(card); err != nil {
		t.Fatalf("delete card: %v", err)
	}

	want := []string{"create", "update", "delete"}
	if len(*got) != len(want) {
		t.Fatalf("got %d publications, want %d", len(*got), len(want))
	}
	for i, p := range *got {
		if p.channel != "cards" {
			t.Errorf("publication %d channel = %q, want %q", i, p.channel, "cards")
		}
		action, id := decode(t, p)
		if action != want[i] || id != card.Id {
			t.Errorf("publication %d = (%q, %q), want (%q, %q)", i, action, id, want[i], card.Id)
		}
	}
}

func TestCardHooks_PublishFailureDoesNotFailTheSave(t *testing.T) {
	app := newTestApp(t)
	newTestHub(app, errors.New("boom"))

	saveCard(t, app, "pod1", "A") // fails the test if the save returns an error
}

func TestHooks_PublishEachCollectionToItsOwnChannel(t *testing.T) {
	app := newTestApp(t)
	_, got := newTestHub(app, nil)

	links := core.NewBaseCollection("card_links")
	links.Fields.Add(&core.TextField{Name: "target_pod"})
	if err := app.Save(links); err != nil {
		t.Fatalf("create collection: %v", err)
	}
	record := core.NewRecord(links)
	record.Set("target_pod", "pod1")
	if err := app.Save(record); err != nil {
		t.Fatalf("save record: %v", err)
	}

	if len(*got) != 1 || (*got)[0].channel != "card_links" {
		t.Errorf("publications = %v, want one on the card_links channel", *got)
	}
}

func TestCardHooks_IgnoreOtherCollections(t *testing.T) {
	app := newTestApp(t)
	_, got := newTestHub(app, nil)

	other := core.NewBaseCollection("others")
	other.Fields.Add(&core.TextField{Name: "pod"})
	if err := app.Save(other); err != nil {
		t.Fatalf("create collection: %v", err)
	}
	record := core.NewRecord(other)
	record.Set("pod", "pod1")
	if err := app.Save(record); err != nil {
		t.Fatalf("save record: %v", err)
	}

	if len(*got) != 0 {
		t.Errorf("got %d publications, want 0", len(*got))
	}
}

func TestPublishMergeAlert(t *testing.T) {
	app := newTestApp(t)
	hub, got := newTestHub(app, nil)

	for _, target := range []string{"p", ""} {
		if err := hub.PublishMergeAlert("c1", target); err != nil {
			t.Fatalf("PublishMergeAlert(%q): %v", target, err)
		}
	}

	if len(*got) != 2 {
		t.Fatalf("got %d publications, want 2", len(*got))
	}
	for i, want := range []string{"p", ""} {
		p := (*got)[i]
		var event struct {
			CardID      string  `json:"cardId"`
			MergeTarget *string `json:"mergeTarget"`
		}
		if err := json.Unmarshal(p.data, &event); err != nil {
			t.Fatalf("decode payload %s: %v", p.data, err)
		}
		if p.channel != MergeAlertChannel || event.CardID != "c1" {
			t.Errorf("publication %d = (%q, %q), want (%q, %q)", i, p.channel, event.CardID, MergeAlertChannel, "c1")
		}
		// An empty target must be sent as null, not as "".
		if (want == "") != (event.MergeTarget == nil) || (event.MergeTarget != nil && *event.MergeTarget != want) {
			t.Errorf("publication %d mergeTarget = %v, want %q", i, event.MergeTarget, want)
		}
	}
}

