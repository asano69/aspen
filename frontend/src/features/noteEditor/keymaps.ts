// Every CodeMirror key binding used by the note editor, grouped by
// origin (Cardpod's own shortcuts vs. each library's own keymap) and
// listed in the precedence order CodeMirror's own keymap() facet
// expects: within a group, the first matching binding wins; across
// groups, earlier keymap.of(...) extensions win over later ones (see
// index.tsx, which turns each group into its own keymap.of(...) call).
//
// Kept as plain data -- no settings UI or override loader exists yet
// -- so a future per-user override (e.g. loaded from a JSON config)
// can replace, reorder, or drop individual groups wholesale instead of
// editing editor setup code directly.
import type { KeyBinding } from "@codemirror/view";
import {
  defaultKeymap,
  historyKeymap,
  indentMore,
  indentLess,
} from "@codemirror/commands";
import { closeBracketsKeymap } from "@codemirror/autocomplete";
import { insertNewlineKeepingBullet } from "./plugins/interactions/bulletEnter";
import { wrapBacktick, wrapBold } from "./plugins/interactions/wrapSelection";

// A named set of bindings a future override could enable, disable, or
// replace as a single unit, instead of editing individual key entries.
export interface KeymapGroup {
  id: string;
  bindings: readonly KeyBinding[];
}

// Cardpod's own editing shortcuts -- the ones a user is most likely to
// want to remap. Tab/Shift-Tab live here rather than in defaultKeymap
// since Cardpod's own indent semantics must win over the library's,
// and a remapped Tab is exactly the kind of thing a future override
// targets.
export const cardpodKeymap: KeymapGroup = {
  id: "cardpod",
  bindings: [
    { key: "Tab", run: indentMore },
    { key: "Shift-Tab", run: indentLess },
    { key: "Enter", run: insertNewlineKeepingBullet },
    { key: "`", run: wrapBacktick },
    { key: "*", run: wrapBold },
  ],
};

// Library-provided keymaps, wrapped in the same KeymapGroup shape so
// they can be toggled off as a unit later (e.g. disabling
// auto-bracket-closing shortcuts) without touching editor setup code.
export const closeBracketsKeymapGroup: KeymapGroup = {
  id: "close-brackets",
  bindings: closeBracketsKeymap,
};

export const historyKeymapGroup: KeymapGroup = {
  id: "history",
  bindings: historyKeymap,
};

export const defaultKeymapGroup: KeymapGroup = {
  id: "default",
  bindings: defaultKeymap,
};

// Every group enabled out of the box, already in the precedence order
// index.tsx needs: Cardpod's own bindings first, so they win over
// defaultKeymap's own Tab/`/`*` bindings; the library keymaps follow
// in their usual relative order.
export const defaultKeymapGroups: readonly KeymapGroup[] = [
  cardpodKeymap,
  closeBracketsKeymapGroup,
  historyKeymapGroup,
  defaultKeymapGroup,
];
