import { Show } from "solid-js";

import UserMenu from "@/components/layout/UserMenu";
import { useVersion } from "@/lib/version";

// The bar pinned to the bottom of the sidebar: the user menu button and the
// running server version.
export default function SidebarFooter() {
  const version = useVersion();

  return (
    <footer class="sidebar-footer">
      <UserMenu />
      <Show when={version()}>v{version()}</Show>
    </footer>
  );
}
