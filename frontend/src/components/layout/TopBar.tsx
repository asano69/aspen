import { createEffect, createSignal, on, Show } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { Menu, Plus, PackageOpen } from "@/lib/icons";
import { titleToSegment } from "@/lib/models/slugify";
import { suggestTitles } from "@/lib/dexie/titleIndex";
import { addPod, orderedPods } from "@/lib/stores/podsStore";
import { normalizeForSearch, searchTitles } from "@/lib/search/titleSearch";
import PodIcon from "../PodIcon";

import TitleSearch from "./TitleSearch";

import UserMenu from "./UserMenu";
import PodMenu from "./PodMenu";
import { topBarActions, topBarPodLink } from "@/lib/topBarSlot";

export interface TopBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

// The hamburger button here only toggles the Sidebar (owned by
// MainLayout, passed in as sidebarOpen/onToggleSidebar). There is no
// separate mobile-only menu anymore.
export default function TopBar(props: TopBarProps) {
  // The text typed in the title search. The "add card" button opens the card
  // with this title, exactly like following a wiki link: an existing card
  // opens, otherwise a draft with that title starts (see CardForm).
  const [query, setQuery] = createSignal("");
  const addCardHref = () => {
    const slug = topBarPodLink()!.slug;
    const title = query().trim();
    return title ? `/${slug}/${titleToSegment(title)}` : `/${slug}/new`;
  };

  // Text typed for one scope must not leak into the other.
  createEffect(
    on(
      () => topBarPodLink() !== undefined,
      () => setQuery(""),
      { defer: true },
    ),
  );

  // Outside a pod the same search and add button work on the pods. Pod titles
  // are not unique, so picking one opens the first pod with that title.
  const navigate = useNavigate();
  const suggestPods = async (text: string) =>
    searchTitles(
      orderedPods().map((pod) => ({
        title: pod.title,
        key: normalizeForSearch(pod.title),
      })),
      text,
      20,
    );
  const openPod = (title: string) => {
    const pod = orderedPods().find((p) => p.title === title);
    if (pod) navigate(`/${pod.name}`);
  };
  const addPodFromQuery = async () => {
    const title = query().trim();
    if (!title) return;
    try {
      navigate(`/${(await addPod(title)).name}`);
    } catch (err) {
      console.error("[top-bar] failed to add the pod:", err);
      window.alert("Failed to add the pod.");
    }
  };

  // Creates a pod titled with the current unix time that links to the open
  // pod (if any), so it shows up in that pod's quick launch bar.
  const addLinkedPod = async () => {
    const links = topBarPodLink() ? [topBarPodLink()!.id] : [];
    try {
      await addPod(String(Math.floor(Date.now() / 1000)), links);
    } catch (err) {
      console.error("[top-bar] failed to add the linked pod:", err);
      window.alert("Failed to add the pod.");
    }
  };

  return (
    // The header is fixed (not sticky): TopBar must float above the
    // scrollable content rather than sit in normal flex flow, or there is
    // nothing visually behind it for its backdrop blur to blur (see
    // .topbar in styles/components/layout.css).
    <header class="topbar">
      <div class="topbar-grid">
        <div class="topbar-left">
          {/* The sidebar is always collapsed by default, so this
              toggle is shown on every device. Its icon is the current
              pod's cover, mirroring the user icon on the right. */}

          <button
            type="button"
            onClick={() => props.onToggleSidebar()}
            aria-label="Toggle sidebar"
            aria-expanded={props.sidebarOpen}
            class="icon-btn"
          >
            <Menu />
          </button>

          {/* Current pod, when the active page registered one (see
              CardList/CardForm's useTopBarPodLink call): its icon and
              name form one link back to that pod's card list, followed
              by the pod's menu. */}
          <Show when={topBarPodLink()}>
            <A href={`/${topBarPodLink()!.slug}`} class="topbar-pod-link">
              <PodIcon src={topBarPodLink()!.cover} />
              <span class="title">{topBarPodLink()!.name}</span>
            </A>
          </Show>
        </div>

        {/* Center slot: "add" and the title search are shared by every page.
            While a pod is in context (CardList and CardForm register a pod
            link via useTopBarPodLink) they work on its cards; otherwise on
            the pods themselves. */}
        <div class="col-search">
          <Show
            when={topBarPodLink()}
            fallback={
              <>
                <button
                  type="button"
                  aria-label="Add pod"
                  title="New"
                  class="new-button"
                  disabled={query().trim() === ""}
                  onClick={addPodFromQuery}
                >
                  <Plus size={20} strokeWidth={4} />
                </button>
                <TitleSearch
                  suggest={suggestPods}
                  onSelect={openPod}
                  onQueryChange={setQuery}
                />
              </>
            }
          >
            <A
              href={addCardHref()}
              aria-label="Add card"
              title="New"
              class="new-button"
            >
              <Plus size={20} strokeWidth={4} />
            </A>
            <TitleSearch
              suggest={(text) => suggestTitles(topBarPodLink()!.id, text)}
              onSelect={(title) =>
                navigate(`/${topBarPodLink()!.slug}/${titleToSegment(title)}`)
              }
              onQueryChange={setQuery}
            />
          </Show>
        </div>

        <nav class="topbar-actions">
          {/* Per-page actions slot (see lib/topBarSlot.ts): renders
              whatever the currently mounted page registered via
              useTopBarActions, e.g. CardForm's pin/delete buttons.
              Empty on pages that register nothing. */}
          {topBarActions()}
          <button
            type="button"
            aria-label="Add linked pod"
            title="Add linked pod"
            class="icon-btn"
            onClick={addLinkedPod}
          >
            <PackageOpen />
          </button>
          <Show when={topBarPodLink()}>
            <PodMenu id={topBarPodLink()!.id} title={topBarPodLink()!.name} />
          </Show>

          <UserMenu />
        </nav>
      </div>
    </header>
  );
}
