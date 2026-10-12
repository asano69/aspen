import { createSignal, type ParentProps } from "solid-js";
import { DragDropProvider } from "@dnd-kit/solid";
import { PointerSensor, KeyboardSensor } from "@dnd-kit/dom";
import { dispatchDragEnd } from "@/lib/dragEnd";
import TopBar from "./TopBar";
import { Sidebar } from "@/features/sidebar";
import Footer from "./Footer";

// CardItem wraps the whole card in an <a> link, and PointerSensor's default
// preventActivation refuses to start a drag on interactive elements
// (<a>/<button>/<input>) unless they're the designated drag handle -- that's
// why no drag ever activated. Overriding it lets a pointerdown on the card
// start tracking; the default per-pointer-type activation constraint (5px of
// movement for mouse) still lets a plain click with no movement fall through
// to the link's normal navigation, and only real dragging hijacks it. The
// same goes for the sidebar's pot rows.
const sensors = [
  PointerSensor.configure({
    preventActivation: () => false,
  }),
  KeyboardSensor,
];

export default function MainLayout(props: ParentProps) {
  // Whether the overlay sidebar is open. The sidebar is collapsed by
  // default on every device and never sits in the page layout itself. Only
  // the toggle button changes this, so it stays open until pressed again.
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const toggleSidebar = () => setSidebarOpen((open) => !open);

  return (
    // One provider for the whole app, so a card can be dragged from the card
    // list onto a pot in the sidebar (see lib/dragEnd.ts).
    <DragDropProvider sensors={sensors} onDragEnd={dispatchDragEnd}>
    {/* .app is bounded to the viewport height, so Sidebar and <main> below
        can each scroll independently instead of the whole page scrolling as
        one (see styles/components/layout.css). */}
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
    </DragDropProvider>
  );
}
