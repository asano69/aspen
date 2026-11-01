import {
  EditorView,
  Decoration,
  WidgetType,
  type DecorationSet,
  type Rect,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { decorationPlugin } from "./decorationPlugin";
import type { SyntaxNodeRef } from "@lezer/common";
import { Deco, revealStyle, isMark, hideContent } from "../../parser/aspen";
import { decoClasses } from "./decoClasses";

// The mark decoration styling a revealable node's whole range. A deco node
// also carries one class per decoration character (see decoClasses.ts). They
// are derived from the source text here rather than stored in the tree,
// because Lezer node types are static and cannot carry per-node data. Every
// other node just gets its revealStyle class.
function revealMark(view: EditorView, node: SyntaxNodeRef, styleClass: string) {
  if (node.type !== Deco) return Decoration.mark({ class: styleClass });
  const open = node.node.firstChild;
  // The opening mark is "[<chars> ": drop the bracket and the space.
  const chars = open ? view.state.sliceDoc(open.from + 1, open.to - 1) : "";
  return Decoration.mark({
    class: [styleClass, ...decoClasses(chars)].join(" "),
  });
}

// At a revealable node's outer boundary, render its source as a non-editable
// widget. This keeps the browser's native selection out of the styled DOM so
// text inserted at the boundary (including IME composition) cannot inherit
// the node's style. The source returns as editable text when the cursor enters.
class RevealPreviewWidget extends WidgetType {
  constructor(
    private readonly styleClass: string,
    private readonly text: string,
    private readonly boundarySide: -1 | 1,
  ) {
    super();
  }

  eq(other: RevealPreviewWidget) {
    return (
      other.styleClass === this.styleClass &&
      other.text === this.text &&
      other.boundarySide === this.boundarySide
    );
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = this.styleClass;
    span.textContent = this.text;
    span.contentEditable = "false";
    return span;
  }

  coordsAt(dom: HTMLElement, _pos: number, side: number): Rect | null {
    const atCaretEdge = this.boundarySide < 0 ? side < 0 : side > 0;
    if (!atCaretEdge) return null;

    const line = dom.closest(".cm-line") as HTMLElement | null;
    if (!line) return null;
    const lineRect = line.getBoundingClientRect();
    const lineStyle = getComputedStyle(line);
    const fontSize = Number.parseFloat(lineStyle.fontSize) || 15;
    const parsedLineHeight = Number.parseFloat(lineStyle.lineHeight);
    const height = Number.isFinite(parsedLineHeight)
      ? parsedLineHeight
      : fontSize;
    const markRect = dom.getBoundingClientRect();
    const left = this.boundarySide < 0 ? markRect.left : markRect.right;
    const top = lineRect.top + (lineRect.height - height) / 2;
    return { left, right: left, top, bottom: top + height };
  }
}

// Hides a delimiter/mark node (e.g. "[* " or "]") using a replacing
// decoration rather than a font-size:0 mark. Decoration.replace()
// collapses the range into a single atomic unit for cursor motion and
// selection, so arrow keys / shift-selection step over the whole
// delimiter at once instead of landing inside its individual
// (invisible) characters. A plain Decoration.mark only restyles the
// existing characters -- they stay non-atomic, which let a selection
// anchor land inside a hidden character, making selection look like
// it silently failed and shifting the copied text by the delimiter's
// own length.
const hiddenMark = Decoration.replace({});

// A cursor on either exclusive edge of a revealable node is outside it,
// independent of CodeMirror's cursor association.
function boundarySideAt(
  selection: { empty: boolean; head: number },
  from: number,
  to: number,
): -1 | 1 | undefined {
  if (!selection.empty) return undefined;
  if (selection.head === from) return -1;
  if (selection.head === to) return 1;
  return undefined;
}

// Placeholder for a revealable node whose content is entirely empty
// (e.g. an empty inline code span, "``"). Hiding both marks in that
// case would leave no visible character at all for the node's own
// Decoration.mark (see buildDecorations below) to style, so the
// background/padding that identifies the span would simply vanish.
// This widget renders a single empty, non-editable span carrying the
// node's own style class instead, so its CSS padding+background still
// draw a small box even with zero text content.
class EmptyRevealWidget extends WidgetType {
  constructor(private readonly styleClass: string) {
    super();
  }

  eq(other: EmptyRevealWidget) {
    return other.styleClass === this.styleClass;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = this.styleClass;
    // Without this, the browser treats the widget as ordinary
    // editable content and can place a native caret inside it.
    span.contentEditable = "false";
    return span;
  }
}

// Generic Obsidian-style live preview: any node type tagged with
// revealStyle (see parser/aspen) gets its full range styled with
// that CSS class at all times. While the cursor is NOT touching the
// node, its direct mark children (tagged with isMark) are hidden --
// so only the styled content shows. The instant the cursor enters the
// node, marks reappear so the raw syntax can be edited; they inherit
// the same style class since it's applied to the whole node range,
// not just the content sub-range.
//
// Adding a new revealable syntax (wikilinks, tags, ...) needs no
// change here -- only new node types in parser/aspen tagged with
// revealStyle/isMark, plus their own scan logic in parseDocument.
function buildDecorations(view: EditorView): DecorationSet {
  const decorations = [];
  const { main } = view.state.selection;
  const activeLine = view.state.doc.lineAt(main.head);
  const previewRanges = new Set<string>();

  syntaxTree(view.state).iterate({
    enter(node) {
      const styleClass = node.type.prop(revealStyle);
      if (!styleClass) return; // not a revealable node type

      const { from, to } = node;
      const boundarySide = boundarySideAt(main, from, to);
      if (boundarySide) {
        // Nested revealable nodes can share a boundary and even the same
        // range. The first (outermost) node owns that preview; adjacent nodes
        // have different ranges and both keep their own boundary widget.
        const rangeKey = `${from}:${to}`;
        if (!previewRanges.has(rangeKey)) {
          previewRanges.add(rangeKey);
          const mark = revealMark(view, node, styleClass);
          decorations.push(
            Decoration.replace({
              widget: new RevealPreviewWidget(
                mark.spec.class as string,
                view.state.sliceDoc(from, to),
                boundarySide,
              ),
            }).range(from, to),
          );
        }
        return false;
      }

      if (node.type === Deco) {
        const decoMark = revealMark(view, node, styleClass);
        decorations.push(decoMark.range(from, to));
      } else {
        decorations.push(revealMark(view, node, styleClass).range(from, to));
      }

      // Line-level editing: every mark on the active line stays visible, so
      // the line being edited always shows its raw notation. This also avoids
      // changing inline DOM around the caret as it crosses a bracket
      // boundary, including just before an IME composition starts.
      const onActiveLine = from <= activeLine.to && to >= activeLine.from;
      if (onActiveLine) return;

      // "Touching" means the current selection overlaps the node's range at
      // all -- not just an empty cursor inside it. Without this, extending a
      // selection into the node can hide marks mid-selection.
      const touching = main.from <= to && main.to >= from;
      if (touching) return; // leave marks visible for editing

      // Some node types (Image, LinkedImage) carry no mark children
      // at all -- their raw "[url]" text is only meaningful while
      // actively editing it, since the actual image already renders
      // separately as a widget (see imageWidget.ts). For those, hide
      // the node's entire range instead of looking for marks to hide.
      if (node.type.prop(hideContent)) {
        decorations.push(
          Decoration.replace({
            widget: new EmptyRevealWidget(styleClass),
          }).range(from, to),
        );
        return;
      }

      // Exactly two mark children (open/close) are expected per
      // revealable node (see parser/aspen's parseDocument) -- the
      // node's content is whatever sits between them.
      const openMark = node.node.firstChild;
      const closeMark = node.node.lastChild;
      // Only a real open/close mark pair can bracket empty content: a node
      // such as Quote starts with an Indent child and ends with ordinary
      // inline children, which must not be mistaken for a mark pair.
      const contentIsEmpty =
        openMark &&
        closeMark &&
        openMark.type.prop(isMark) &&
        closeMark.type.prop(isMark) &&
        openMark.to === closeMark.from;

      if (contentIsEmpty) {
        decorations.push(
          Decoration.replace({
            widget: new EmptyRevealWidget(styleClass),
          }).range(from, to),
        );
        return;
      }

      for (let child = node.node.firstChild; child; child = child.nextSibling) {
        if (child.type.prop(isMark)) {
          decorations.push(hiddenMark.range(child.from, child.to));
        }
      }
    },
  });

  return Decoration.set(decorations, true);
}

// IME-safe rebuilding is handled by decorationPlugin (see its comment).
export const syntaxReveal = decorationPlugin({
    build: buildDecorations,
    // A new syntax tree (e.g. after a background parse of a long
    // document) also changes which nodes exist to be styled or hidden.
    shouldRebuild: (update) =>
      update.docChanged ||
      update.selectionSet ||
      syntaxTree(update.startState) !== syntaxTree(update.state),
  });
