import { createSignal, For } from "solid-js";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { Check, ChevronDown } from "@/lib/icons";

interface QuickMenuProps {
  // Class naming this particular menu (e.g. "page-sort-menu"). Applied to
  // both the trigger and the opened menu, so either can be targeted from CSS.
  menuClass: string;
  // Heading shown at the top of the opened menu.
  header: string;
  options: string[];
}

// One dropdown of the quick launch bar: the trigger shows the selected
// option, the menu lists all of them. The selection is local and dummy for
// now; nothing reads it yet.
function QuickMenu(props: QuickMenuProps) {
  const [selected, setSelected] = createSignal(props.options[0]);

  return (
    <DropdownMenu>
      {/* The label and the arrow are one button: no border or fill, only a
          background tint on hover. */}
      <DropdownMenu.Trigger class={`${props.menuClass} quick-launch-trigger`}>
        {selected()}
        <ChevronDown size={14} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class={`${props.menuClass} menu-content`}>
          <DropdownMenu.Group>
            <DropdownMenu.GroupLabel class="menu-group-label">
              {props.header}
            </DropdownMenu.GroupLabel>
            <For each={props.options}>
              {(option) => (
                <DropdownMenu.Item
                  onSelect={() => setSelected(option)}
                  class="menu-item"
                >
                  <span class="menu-item-label">{option}</span>
                  {selected() === option && <Check size={16} />}
                </DropdownMenu.Item>
              )}
            </For>
          </DropdownMenu.Group>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}

// Row of dropdown menus above the card grid (display mode, sort, filter),
// right-aligned. Dummy for now: none of the choices affects the grid yet.
export default function QuickLaunch() {
  return (
    <div class="quick-launch">
      <div class="flex-box">
        <QuickMenu
          menuClass="page-list-mode-menu"
          header="Display by"
          options={["Card", "Table", "Graph"]}
        />
        <QuickMenu
          menuClass="page-sort-menu"
          header="Sort by"
          options={[
            "Manual",
            "Modified",
            "Created",
            "Last visited",
            "Most linked",
            "Most viewed",
            "Title",
          ]}
        />
        <QuickMenu
          menuClass="page-filter-menu"
          header="Filter by"
          options={["All"]}
        />
      </div>
    </div>
  );
}
