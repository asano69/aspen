import { Show } from "solid-js";
import { Popover } from "@kobalte/core/popover";
import type { TelomereEntry } from "@/lib/models/telomere";

// A clicked telomere bar: the line's entry and the bar it was clicked on.
export interface TelomereSelection {
  entry: TelomereEntry;
  anchor: HTMLElement;
}

export interface TelomerePopoverProps {
  selection: TelomereSelection | undefined;
  onClose: () => void;
}

// Shows who edited a line and when, next to the clicked telomere bar. Closes
// on Escape or a click outside.
export default function TelomerePopover(props: TelomerePopoverProps) {
  return (
    <Show when={props.selection}>
      {(selection) => (
        <Popover
          open
          onOpenChange={(open) => {
            if (!open) props.onClose();
          }}
          placement="right-start"
          getAnchorRect={() => selection().anchor.getBoundingClientRect()}
        >
          <Popover.Portal>
            <Popover.Content class="popover-content">
              <div class="popover-row">
                <span class="popover-label">Line ID</span>
                {selection().entry.id || "(not saved yet)"}
              </div>
              <div class="popover-row">
                <span class="popover-label">User</span>
                {selection().entry.user || "unknown"}
              </div>
              <div class="popover-row">
                <span class="popover-label">Updated</span>
                {new Date(selection().entry.updatedAt).toLocaleString()}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover>
      )}
    </Show>
  );
}
