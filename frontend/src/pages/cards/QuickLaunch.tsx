import { createSignal, For } from "solid-js";
import { A } from "@solidjs/router";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import PotIcon from "@/components/PotIcon";
import { potCoverURL } from "@/lib/api/pots";
import { Check, ChevronDown } from "@/lib/icons";
import { orderedPots } from "@/lib/stores/potsStore";
import { usePot } from "../pots/PotContext";

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

// Bar above the card grid. Left: the pots whose "links" reference the open
// pot, as round icons (the title shows on hover). Right: dropdown menus
// (display mode, sort, filter), dummy for now: none of the choices affects
// the grid yet. Outside a pot (the root page) there is no open pot, so the
// left side stays empty.
export default function QuickLaunch() {
  const pot = usePot();
  const linkingPots = () => {
    const id = pot()?.id;
    return id ? orderedPots().filter((p) => p.links?.includes(id)) : [];
  };

  return (
    <div class="quick-launch">
      <div class="flex-box">
        <div class="quick-launch-pots">
          <For each={linkingPots()}>
            {(linking) => (
              <A
                href={`/${linking.name}`}
                class="quick-launch-pot"
                title={linking.title}
                aria-label={linking.title}
              >
                <PotIcon src={potCoverURL(linking)} />
              </A>
            )}
          </For>
        </div>
        <div class="quick-launch-menus">
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
    </div>
  );
}
