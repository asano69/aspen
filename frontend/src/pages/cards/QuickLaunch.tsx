import { createSignal, For } from "solid-js";
import { A } from "@solidjs/router";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import PodIcon from "@/components/PodIcon";
import { podCoverURL } from "@/lib/api/pods";
import { Check, ChevronDown } from "@/lib/icons";
import { orderedPods } from "@/lib/stores/podsStore";
import { cardSort, setCardSort } from "@/lib/stores/cardsStore";
import type { CardSort } from "@/lib/models/card";
import {
  DISPLAY_MODES,
  podsDisplayMode,
  setPodsDisplayMode,
  type DisplayMode,
} from "@/lib/stores/displayModeStore";
import { usePod } from "../pods/PodContext";

// The orders a pod's card list supports, by the label the menu shows.
const CARD_SORTS: Record<string, CardSort> = {
  Modified: "updated",
  Created: "created",
};

const sortLabel = (sort: CardSort) =>
  sort === "updated" ? "Modified" : "Created";

// Outside a pod (the root page) the sort menu is still a dummy.
const DUMMY_SORT_OPTIONS = [
  "Modified",
  "Created",
  "Last visited",
  "Most linked",
  "Most viewed",
  "Title",
];

interface QuickMenuProps {
  // Class naming this particular menu (e.g. "page-sort-menu"). Applied to
  // both the trigger and the opened menu, so either can be targeted from CSS.
  menuClass: string;
  // Heading shown at the top of the opened menu.
  header: string;
  options: string[];
  // When given, the menu shows this option and reports a pick through
  // onChange. Without them the selection is local and dummy.
  value?: string;
  onChange?: (option: string) => void;
}

// One dropdown of the quick launch bar: the trigger shows the selected
// option, the menu lists all of them.
function QuickMenu(props: QuickMenuProps) {
  const [local, setLocal] = createSignal(props.options[0]);
  const selected = () => props.value ?? local();
  const select = (option: string) => {
    setLocal(option);
    props.onChange?.(option);
  };

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
                  onSelect={() => select(option)}
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

// Bar above the card grid. Left: the pods whose "links" reference the open
// pod, as round icons (the title shows on hover). Right: dropdown menus
// (display mode, sort, filter), dummy for now: none of the choices affects
// the grid yet. Outside a pod (the root page) there is no open pod, so the
// left side stays empty.
export default function QuickLaunch() {
  const pod = usePod();
  const linkingPods = () => {
    const id = pod()?.id;
    return id ? orderedPods().filter((p) => p.links?.includes(id)) : [];
  };

  return (
    <div class="quick-launch">
      <div class="flex-box">
        <div class="quick-launch-pods">
          <For each={linkingPods()}>
            {(linking) => (
              <A
                href={`/${linking.name}`}
                class="quick-launch-pod"
                title={linking.title}
                aria-label={linking.title}
              >
                <PodIcon src={podCoverURL(linking)} />
              </A>
            )}
          </For>
        </div>
        <div class="quick-launch-menus">
          <QuickMenu
            menuClass="page-list-mode-menu"
            header="Display by"
            options={[...DISPLAY_MODES]}
            // Only the root page (no open pod) has a graph view so far.
            value={pod() ? undefined : podsDisplayMode()}
            onChange={(mode) => {
              if (!pod()) setPodsDisplayMode(mode as DisplayMode);
            }}
          />
          <QuickMenu
            menuClass="page-sort-menu"
            header="Sort by"
            options={pod() ? Object.keys(CARD_SORTS) : DUMMY_SORT_OPTIONS}
            value={pod() ? sortLabel(cardSort()) : undefined}
            onChange={(label) => {
              if (pod()) setCardSort(CARD_SORTS[label]);
            }}
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
