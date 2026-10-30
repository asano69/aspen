import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { wrapBacktick, wrapBold } from "./wrapSelection";

// Same fake-view pattern as bulletEnter.test.ts: these commands only
// read `view.state` and call `view.dispatch(tr)`, so a plain object
// satisfying that shape is enough -- no real EditorView needed.
function runCommand(
  command: typeof wrapBacktick,
  doc: string,
  anchor: number,
  head: number,
) {
  const state = EditorState.create({
    doc,
    selection: { anchor, head },
  });

  let result: EditorState = state;
  const fakeView = {
    state,
    dispatch(tr: import("@codemirror/state").Transaction) {
      result = tr.state;
    },
  } as unknown as EditorView;

  const handled = command(fakeView);
  return { handled, result };
}

describe("wrapBacktick", () => {
  it("wraps a selection in backticks and places the cursor after the closing backtick", () => {
    const { handled, result } = runCommand(wrapBacktick, "hello world", 0, 5);
    expect(handled).toBe(true);
    expect(result.doc.toString()).toBe("`hello` world");
    expect(result.selection.main.from).toBe(7);
    expect(result.selection.main.to).toBe(7);
  });

  it("does nothing (falls through) when there is no selection", () => {
    const { handled, result } = runCommand(wrapBacktick, "hello", 2, 2);
    expect(handled).toBe(false);
    expect(result.doc.toString()).toBe("hello");
  });
});

describe("wrapBold", () => {
  it("wraps a selection in Aspen's [* ] bold syntax and places the cursor right after the *", () => {
    const { handled, result } = runCommand(wrapBold, "hello world", 6, 11);
    expect(handled).toBe(true);
    expect(result.doc.toString()).toBe("hello [* world]");
    expect(result.selection.main.from).toBe(8);
    expect(result.selection.main.to).toBe(8);
  });

  it("does nothing (falls through) when there is no selection", () => {
    const { handled, result } = runCommand(wrapBold, "hello", 2, 2);
    expect(handled).toBe(false);
    expect(result.doc.toString()).toBe("hello");
  });
});
