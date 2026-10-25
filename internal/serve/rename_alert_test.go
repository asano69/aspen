package serve

import (
	"slices"
	"testing"
)

func TestLinkingCards_OnlyLiveCardsOfTheSamePod(t *testing.T) {
	app := newLinksTestApp(t)
	pod := createPod(t, app, "pod1")
	other := createPod(t, app, "pod2")

	self := createLinksTestCard(t, app, pod.Id, "Self", "")
	b := createLinksTestCard(t, app, pod.Id, "B", "")
	gone := createLinksTestCard(t, app, pod.Id, "Gone", "")
	elsewhere := createLinksTestCard(t, app, other.Id, "Elsewhere", "")
	createLink(t, app, self.Id, pod.Id, "Old") // the card's own link is reported too
	createLink(t, app, b.Id, pod.Id, "Old")
	createLink(t, app, gone.Id, pod.Id, "Old")
	createLink(t, app, elsewhere.Id, other.Id, "Old")
	softDelete(t, app, gone)

	got, err := linkingCards(app, pod.Id, "old")
	if err != nil {
		t.Fatalf("linkingCards: %v", err)
	}
	var titles []string
	for _, c := range got {
		titles = append(titles, c.Title)
	}
	if want := []string{"B", "Self"}; !slices.Equal(titles, want) {
		t.Errorf("titles = %q, want %q", titles, want)
	}
}

func TestTitleWatcherAlertRename(t *testing.T) {
	app := newLinksTestApp(t)
	pod := createPod(t, app, "pod1")
	card := createLinksTestCard(t, app, pod.Id, "New", "")
	b := createLinksTestCard(t, app, pod.Id, "B", "")
	createLink(t, app, b.Id, pod.Id, "Old")

	var got []string
	w := newTitleWatcher()
	w.notifyRename = func(cardID, oldTitle string, linkedFrom []string) error {
		got = append(got, cardID+"/"+oldTitle+"/"+linkedFrom[0])
		return nil
	}

	w.alertRename(app, pod.Id, card.Id, "Old", "New")     // linked: alert
	w.alertRename(app, pod.Id, card.Id, "Nobody", "New")  // no linkers: nothing
	w.alertRename(app, pod.Id, card.Id, "Old", "OLD")     // case only: nothing

	// Linked only from itself: nothing to warn about.
	selfOnly := createLinksTestCard(t, app, pod.Id, "Solo", "")
	createLink(t, app, selfOnly.Id, pod.Id, "Prev")
	w.alertRename(app, pod.Id, selfOnly.Id, "Prev", "Solo")

	// Linked from itself and another card: alert, listing both.
	mixed := createLinksTestCard(t, app, pod.Id, "Mixed", "")
	createLink(t, app, mixed.Id, pod.Id, "Was")
	createLink(t, app, b.Id, pod.Id, "Was")
	w.alertRename(app, pod.Id, mixed.Id, "Was", "Mixed")

	if want := []string{card.Id + "/Old/B", mixed.Id + "/Was/B"}; !slices.Equal(got, want) {
		t.Errorf("notifications = %q, want %q", got, want)
	}
}
