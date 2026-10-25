import { For, Show, type Component } from "solid-js";
import { A } from "@solidjs/router";

import { useVersion } from "@/lib/version";

import SidebarPodList from "./SidebarPodList";

interface NavItem {
  href: string;
  label: string;
  icon: Component<{ size?: number }>;
}

// Static top-level nav items, in the order they're shown. Kept as plain
// data so each entry is just a {href, label, icon} tuple instead of
// duplicating the same <A> markup per page. Themes now lives in
// TopBar next to the logo instead of here (see TopBar.tsx). Empty now
// that Diary has been removed; add future top-level pages here.
const NAV_ITEMS: NavItem[] = [];

export interface SidebarProps {
  open: boolean;
}

export default function Sidebar(props: SidebarProps) {
  const version = useVersion();

  return (
    <>
      {/* The sidebar always floats above the page instead of sitting in
          the flex layout. It stays open until TopBar's toggle button is
          pressed again: there is no click-outside handling. It shows its
          open state through [data-open] (see styles/components/sidebar.css).
          Always mounted (not conditionally rendered via <Show>) so the
          transform transition actually animates open <-> closed instead of
          the element just appearing/disappearing. It's translated
          off-screen when closed, and its shadow is dropped then too, so the
          shadow's blur does not bleed into the viewport. */}
      <aside
        class="sidebar"
        data-open={props.open ? "" : undefined}
        aria-hidden={!props.open}
      >
        {/* Scrollable middle section: nav items plus the pod list, so a
            long pod list scrolls on its own instead of pushing the footer
            below off the sidebar. TopBar is fixed and floats over this
            column too, so its own top item needs an offset to stay clear
            of the header. */}
        <div class="sidebar-body">
          <nav class="sidebar-nav">
            <For each={NAV_ITEMS}>
              {(item) => (
                <A href={item.href} end class="sidebar-link">
                  <item.icon size={20} />
                  {item.label}
                </A>
              )}
            </For>
          </nav>

          <SidebarPodList open={props.open} />
        </div>

        {/* Pinned to the bottom of the sidebar regardless of how tall the
            content above ends up being, and never squeezed by it. */}
        <footer class="sidebar-footer">
          <Show when={version()}>v{version()}</Show>
        </footer>
      </aside>
    </>
  );
}
