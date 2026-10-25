import { createSignal, createEffect, onCleanup, type JSX } from "solid-js";

// Holds whatever the currently active page wants shown in TopBar's
// per-page actions slot (see components/layout/TopBar.tsx). This is
// the "slot" layer between the layout's fixed structure (TopBar) and
// a page's own content (e.g. CardForm's pin/delete buttons): TopBar
// only knows a slot exists, never what any given page puts into it.
const [topBarActions, setTopBarActions] = createSignal<JSX.Element>();
export { topBarActions };

// Registers `actions` as the page's contribution to TopBar's
// per-page slot for as long as the calling component stays mounted,
// clearing it again on cleanup. Same restore-on-unmount shape as
// useTitle.ts, except there's nothing to restore back to -- only one
// page's actions are ever relevant at a time, so cleanup just clears
// the slot instead of reinstating a previous value.
export function useTopBarActions(actions: () => JSX.Element | undefined): void {
  createEffect(() => {
    setTopBarActions(actions());
  });
  onCleanup(() => setTopBarActions(undefined));
}

// A page can also show a link to its parent pod next to TopBar's Pod
// icon (e.g. CardList/CardForm showing the current pod's name). Kept
// as its own signal, not folded into topBarActions, since it has a
// different shape (a name + slug, not raw JSX) and a different
// position in TopBar's markup.
export interface TopBarPodLink {
  name: string;
  slug: string;
  // The pod's id, used by the title search to query the pod's cards.
  id: string;
  // URL of the pod's cover image, shown as the sidebar toggle's icon.
  cover?: string;
}

const [topBarPodLink, setTopBarPodLink] = createSignal<TopBarPodLink>();
export { topBarPodLink };

// Registers `link` as the current pod link for as long as the calling
// component stays mounted, clearing it again on cleanup -- same
// pattern as useTopBarActions above.
export function useTopBarPodLink(link: () => TopBarPodLink | undefined): void {
  createEffect(() => {
    setTopBarPodLink(link());
  });
  onCleanup(() => setTopBarPodLink(undefined));
}
