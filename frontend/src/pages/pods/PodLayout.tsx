import {
  createEffect,
  createResource,
  onCleanup,
  type ParentProps,
} from "solid-js";
import { useParams } from "@solidjs/router";

import { fetchPodByName, podCoverURL } from "@/lib/api/pods";
import { useTopBarPodLink } from "@/lib/topBarSlot";
import { useFavicon } from "@/lib/useFavicon";
import { ensurePodSynced, releasePod } from "@/lib/stores/cardsStore";
import { orderedPods } from "@/lib/stores/podsStore";
import {
  markLinkAlivePodReady,
  releaseLinkAlive,
} from "@/lib/stores/linkAliveStore";
import { closePodReplicas, openPodReplicas } from "@/lib/dexie/dataReplicas";
import { releaseTitleIndex } from "@/lib/dexie/titleIndex";
import PodContext from "./PodContext";

// Wraps every route scoped to a single pod (CardList, CardForm) so the
// pod's TopBar link (see lib/topBarSlot.ts) is registered exactly once
// per pod, not once per page. Before this existed, CardList and
// CardForm each called useTopBarPodLink themselves; navigating between
// them unmounted one page's registration (clearing the link) before
// the other page's mounted its own, flickering TopBar's pod-name link
// and "add card" button on every transition. Nesting both pages under
// this layout keeps the registration mounted continuously across that
// transition instead.
//
// The pod itself is also fetched exactly once here and shared via
// PodContext, instead of each nested page fetching it again on its
// own -- CardList and CardForm used to each run their own
// fetchPodBySlug, and navigating between them while the first request
// was still in flight made PocketBase's SDK auto-cancel it as a
// duplicate, breaking navigation.
export default function PodLayout(props: ParentProps) {
  const params = useParams();
  const [pod] = createResource(() => params.slug, fetchPodByName);

  // The pods store holds the latest title (it changes on rename), while the
  // fetched record above does not.
  const title = () =>
    orderedPods().find((p) => p.id === pod()?.id)?.title ?? pod()?.title;

  useTopBarPodLink(() =>
    pod()
      ? {
          name: title()!,
          slug: params.slug,
          id: pod()!.id,
          cover: podCoverURL(pod()!),
        }
      : undefined,
  );

  // The tab icon follows the open pod's cover. Leaving the pod restores
  // the app's own icon (see useFavicon.ts).
  useFavicon(() => (pod() ? podCoverURL(pod()!) : undefined));

  // Drops the pod's loaded cards once the user leaves it (another pod, or
  // the pod list). Moving between CardList and CardForm keeps this layout
  // mounted, so both survive that. The pod's cards replica and its data-only
  // replicas (see lib/dexie/dataReplicas.ts) are synced for as long as it is
  // open, so a card opened directly by URL finds an up-to-date replica too.
  // Link results (see lib/stores/linkAliveStore.ts) are only computed once
  // both replicas have synced, so a half-filled replica never marks a live
  // link as dead. Realtime is not handled here: AppShell watches the channels
  // for the whole session.
  createEffect(() => {
    const id = pod()?.id;
    if (!id) return;
    let open = true;
    void Promise.all([openPodReplicas(id), ensurePodSynced(id)]).then(() => {
      if (open) markLinkAlivePodReady(id);
    });
    onCleanup(() => {
      open = false;
      releasePod(id);
      closePodReplicas(id);
      releaseTitleIndex(id);
      releaseLinkAlive(id);
    });
  });

  return (
    <PodContext.Provider value={pod}>{props.children}</PodContext.Provider>
  );
}
