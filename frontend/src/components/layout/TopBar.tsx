import { createSignal, Show } from "solid-js";
import { A } from "@solidjs/router";
import { Plus, Menu } from "@/lib/icons";
import { titleToSegment } from "@/lib/models/slugify";
import PotIcon from "../PotIcon";

import TitleSearch from "./TitleSearch";

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
            <Menu />
          </button>
          {/* Current pot's name, when the active page registered one
              (see CardList/CardForm's useTopBarPotLink call). Links
              back to that pot's card list. */}
          <Show when={topBarPotLink()}>
            <A href={`/${topBarPotLink()!.slug}`} class="topbar-pot-link">
              {topBarPotLink()!.name}
            </A>
          </Show>
        </div>

        {/* Center slot: "add card" and the title search are shared between
            CardList and CardForm (both register a pot link via
            useTopBarPotLink), so they live here instead of being
            duplicated as per-page controls. Only shown while a pot is in
            context -- there's nothing to add to or search from the pots
            list itself. */}
        <div class="col-search">
          <Show when={topBarPotLink()}>
            <A
              href={addCardHref()}
              aria-label="Add card"
              title="New"
              class="new-button"
            >
              <Plus size={20} strokeWidth={4} />
            </A>
            <TitleSearch
              potId={topBarPotLink()!.id}
              potSlug={topBarPotLink()!.slug}
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

          {/* The current pot's icon again, at the right edge: it links
              to the pot's card list, or to the pot list outside a pot. */}
          <A
            href={topBarPotLink() ? `/${topBarPotLink()!.slug}` : "/"}
            aria-label="Pot"
            class="icon-btn"
          >
            <PotIcon src={topBarPotLink()?.cover} />
          </A>
        </nav>
      </div>
    </header>
  );
}
