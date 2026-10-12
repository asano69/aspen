import { createSignal, type ParentProps } from "solid-js";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import Footer from "./Footer";

export default function MainLayout(props: ParentProps) {
  // Whether the overlay sidebar is open. The sidebar is collapsed by
  // default on every device and never sits in the page layout itself. Only
  // the toggle button changes this, so it stays open until pressed again.
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const toggleSidebar = () => setSidebarOpen((open) => !open);

  return (
    // .app is bounded to the viewport height, so Sidebar and <main> below
    // can each scroll independently instead of the whole page scrolling as
    // one (see styles/components/layout.css).
    <div class="app">
      {/* TopBar with logo and sidebar toggle. Its height comes from the
          --topbar-height token, so there is nothing to size here. */}
      <TopBar sidebarOpen={sidebarOpen()} onToggleSidebar={toggleSidebar} />

      {/* Main content area. It is the positioning context of the
          sidebar overlay, so the overlay starts below TopBar instead of
          covering the whole viewport. */}
      <div class="app-body">
        <Sidebar open={sidebarOpen()} />

        {/* Main content. A page that wants to fill the remaining height
            (e.g. the note editor) can do so with flex, while pages with
            normal document flow just grow past this height and main's own
            scrolling takes over. TopBar floats above (it is fixed), so
            scrolled content passes underneath its translucent
            background, which is what makes its backdrop blur visible. */}
        <main class="app-main">
          <div class="app-content">{props.children}</div>
        </main>
      </div>

      <Footer />
    </div>
  );
}
