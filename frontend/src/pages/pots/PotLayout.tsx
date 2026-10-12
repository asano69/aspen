import {
  createEffect,
  createResource,
  onCleanup,
  type ParentProps,
} from "solid-js";
import { useParams } from "@solidjs/router";

import { fetchPotByName, potCoverURL } from "@/lib/api/pots";
import { useTopBarPotLink } from "@/lib/topBarSlot";
import { useFavicon } from "@/lib/useFavicon";
import { ensurePotSynced, releasePot } from "@/lib/stores/cardsStore";
import { orderedPots } from "@/lib/stores/potsStore";
import {
  markLinkAlivePotReady,
  releaseLinkAlive,
} from "@/lib/stores/linkAliveStore";
import { closePotReplicas, openPotReplicas } from "@/lib/dexie/dataReplicas";
import { releaseTitleIndex } from "@/lib/dexie/titleIndex";
import PotContext from "./PotContext";

// Wraps every route scoped to a single pot (CardList, CardForm) so the
// pot's TopBar link (see lib/topBarSlot.ts) is registered exactly once
// per pot, not once per page. Before this existed, CardList and
// CardForm each called useTopBarPotLink themselves; navigating between
// them unmounted one page's registration (clearing the link) before
// the other page's mounted its own, flickering TopBar's pot-name link
// and "add card" button on every transition. Nesting both pages under
// this layout keeps the registration mounted continuously across that
// transition instead.
//
// The pot itself is also fetched exactly once here and shared via
// PotContext, instead of each nested page fetching it again on its
// own -- CardList and CardForm used to each run their own
// fetchPotBySlug, and navigating between them while the first request
// was still in flight made PocketBase's SDK auto-cancel it as a
// duplicate, breaking navigation.
export default function PotLayout(props: ParentProps) {
  const params = useParams();
  const [pot] = createResource(() => params.slug, fetchPotByName);

  // The pots store holds the latest title (it changes on rename), while the
  // fetched record above does not.
  const title = () =>
    orderedPots().find((p) => p.id === pot()?.id)?.title ?? pot()?.title;

  useTopBarPotLink(() =>
    pot()
      ? {
          name: title()!,
          slug: params.slug,
          id: pot()!.id,
          cover: potCoverURL(pot()!),
        }
      : undefined,
  );

  // The tab icon follows the open pot's cover. Leaving the pot restores
  // the app's own icon (see useFavicon.ts).
  useFavicon(() => (pot() ? potCoverURL(pot()!) : undefined));

  // Drops the pot's loaded cards once the user leaves it (another pot, or
  // the pot list). Moving between CardList and CardForm keeps this layout
  // mounted, so both survive that. The pot's cards replica and its data-only
  // replicas (see lib/dexie/dataReplicas.ts) are synced for as long as it is
  // open, so a card opened directly by URL finds an up-to-date replica too.
  // Link results (see lib/stores/linkAliveStore.ts) are only computed once
  // both replicas have synced, so a half-filled replica never marks a live
  // link as dead. Realtime is not handled here: AppShell watches the channels
  // for the whole session.
  createEffect(() => {
    const id = pot()?.id;
    if (!id) return;
    let open = true;
    void Promise.all([openPotReplicas(id), ensurePotSynced(id)]).then(() => {
      if (open) markLinkAlivePotReady(id);
    });
    onCleanup(() => {
      open = false;
      releasePot(id);
      closePotReplicas(id);
      releaseTitleIndex(id);
      releaseLinkAlive(id);
    });
  });

  return (
    <PotContext.Provider value={pot}>{props.children}</PotContext.Provider>
  );
}
