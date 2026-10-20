import { createEffect, createSignal, on, Show } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { Plus, Menu, PackageOpen } from "@/lib/icons";
import { titleToSegment } from "@/lib/models/slugify";
import { suggestTitles } from "@/lib/dexie/titleIndex";
import { addPot, orderedPots } from "@/lib/stores/potsStore";
import { normalizeForSearch, searchTitles } from "@/lib/search/titleSearch";
import PotIcon from "../PotIcon";

import TitleSearch from "./TitleSearch";

import UserMenu from "./UserMenu";
import PotMenu from "./PotMenu";
import { topBarActions, topBarPotLink } from "@/lib/topBarSlot";

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
    const slug = topBarPotLink()!.slug;
    const title = query().trim();
    return title ? `/${slug}/${titleToSegment(title)}` : `/${slug}/new`;
  };

  // Text typed for one scope must not leak into the other.
  createEffect(
    on(
      () => topBarPotLink() !== undefined,
      () => setQuery(""),
      { defer: true },
    ),
  );

  // Outside a pot the same search and add button work on the pots. Pot titles
  // are not unique, so picking one opens the first pot with that title.
  const navigate = useNavigate();
  const suggestPots = async (text: string) =>
    searchTitles(
      orderedPots().map((pot) => ({
        title: pot.title,
        key: normalizeForSearch(pot.title),
      })),
      text,
      20,
    );
  const openPot = (title: string) => {
    const pot = orderedPots().find((p) => p.title === title);
    if (pot) navigate(`/${pot.name}`);
  };
  const addPotFromQuery = async () => {
    const title = query().trim();
    if (!title) return;
    try {
      navigate(`/${(await addPot(title)).name}`);
    } catch (err) {
      console.error("[top-bar] failed to add the pot:", err);
      window.alert("Failed to add the pot.");
    }
  };

  // Creates a pot titled with the current unix time that links to the open
  // pot (if any), so it shows up in that pot's quick launch bar.
  const addLinkedPot = async () => {
    const links = topBarPotLink() ? [topBarPotLink()!.id] : [];
    try {
      await addPot(String(Math.floor(Date.now() / 1000)), links);
    } catch (err) {
      console.error("[top-bar] failed to add the linked pot:", err);
      window.alert("Failed to add the pot.");
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
              pot's cover, mirroring the user icon on the right. */}

          <button
            type="button"
            onClick={() => props.onToggleSidebar()}
            aria-label="Toggle sidebar"
            aria-expanded={props.sidebarOpen}
            class="icon-btn"
          >
            <Menu src={topBarPotLink()?.cover} />
          </button>

          {/* Current pot, when the active page registered one (see
              CardList/CardForm's useTopBarPotLink call): its icon and
              name form one link back to that pot's card list, followed
              by the pot's menu. */}
          <Show when={topBarPotLink()}>
            <A href={`/${topBarPotLink()!.slug}`} class="topbar-pot-link">
              <PotIcon src={topBarPotLink()!.cover} />
              <span class="title">{topBarPotLink()!.name}</span>
            </A>
          </Show>
        </div>

        {/* Center slot: "add" and the title search are shared by every page.
            While a pot is in context (CardList and CardForm register a pot
            link via useTopBarPotLink) they work on its cards; otherwise on
            the pots themselves. */}
        <div class="col-search">
          <Show
            when={topBarPotLink()}
            fallback={
              <>
                <button
                  type="button"
                  aria-label="Add pot"
                  title="New"
                  class="new-button"
                  disabled={query().trim() === ""}
                  onClick={addPotFromQuery}
                >
                  <Plus size={20} strokeWidth={4} />
                </button>
                <TitleSearch
                  suggest={suggestPots}
                  onSelect={openPot}
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
              suggest={(text) => suggestTitles(topBarPotLink()!.id, text)}
              onSelect={(title) =>
                navigate(`/${topBarPotLink()!.slug}/${titleToSegment(title)}`)
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
            aria-label="Add linked pot"
            title="Add linked pot"
            class="icon-btn"
            onClick={addLinkedPot}
          >
            <PackageOpen />
          </button>
          <Show when={topBarPotLink()}>
            <PotMenu id={topBarPotLink()!.id} title={topBarPotLink()!.name} />
          </Show>

          <UserMenu />
        </nav>
      </div>
    </header>
  );
}
