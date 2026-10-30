import { ensureSyntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { IterMode, type Tree } from "@lezer/common";

// How long dumpTree() may block while parsing the whole document.
// Long documents are allowed to freeze the tab for this purpose.
const PARSE_TIMEOUT_MS = 60_000;

export interface DebugNode {
  name: string;
  // The source text the node covers, used instead of from/to positions.
  text: string;
  children: DebugNode[];
}

// Converts `tree` into plain nested objects, replacing each node's
// from/to positions with the source text it covers. Trees mounted by
// nested languages (e.g. inside `code:` blocks) are skipped: this is a
// debugger for Aspen's own grammar.
export function syntaxTreeToJson(tree: Tree, doc: string): DebugNode {
  const root: DebugNode[] = [];
  // Each entry is the children array the next entered node is added to.
  const stack: DebugNode[][] = [root];
  tree.iterate({
    mode: IterMode.IgnoreMounts,
    enter(node) {
      const item: DebugNode = {
        name: node.name,
        text: doc.slice(node.from, node.to),
        children: [],
      };
      stack[stack.length - 1].push(item);
      stack.push(item.children);
    },
    leave() {
      stack.pop();
    },
  });
  return root[0];
}

// The editor currently mounted, if any (see registerDebugView).
let currentView: EditorView | undefined;

// Called by NoteEditor on mount. Returns the matching unregister function,
// meant to be passed to onCleanup.
export function registerDebugView(view: EditorView): () => void {
  currentView = view;
  return () => {
    if (currentView === view) currentView = undefined;
  };
}

// Forces a complete parse of the current editor's document (the editor
// itself normally parses lazily) and returns the resulting tree as
// nested plain objects. Returns null if no editor is mounted, or if
// parsing did not finish within PARSE_TIMEOUT_MS. Shared by the
// browser-console entry point below and by CardForm's own "dump
// syntax tree" debug action (see pages/cards/CardForm.tsx).
export function getSyntaxTreeJson(): DebugNode | null {
  if (!currentView) return null;
  const { state } = currentView;
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_TIMEOUT_MS);
  if (!tree) return null;
  return syntaxTreeToJson(tree, state.doc.toString());
}

// Logs the current editor's syntax tree to the console.
function dumpCurrentEditor(): void {
  const json = getSyntaxTreeJson();
  if (!json) {
    console.warn(
      "[aspenDebug] no editor is mounted, or parsing did not finish in time",
    );
    return;
  }
  console.log(json);
}

// Usage from the browser console: aspenDebug.dumpTree()
Object.assign(window, { aspenDebug: { dumpTree: dumpCurrentEditor } });
