import {
  EditorView,
  Decoration,
  WidgetType,
  type DecorationSet,
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

// Keep editable text on either side of a bracketed decoration in its own
// DOM text node. Without these zero-width boundaries, the browser can leave
// the caret in the decoration's marked span after `]` is typed. That is
// especially troublesome for IME composition, which starts before the next
// syntax-tree rebuild. The widgets carry no document text and are not
// editable; CodeMirror still owns the selection at the adjacent document
// position.
class DecorationBoundaryWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-decoration-boundary";
    span.contentEditable = "false";
    return span;
  }
}

const decorationBoundary = new DecorationBoundaryWidget();

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

  syntaxTree(view.state).iterate({
    enter(node) {
      const styleClass = node.type.prop(revealStyle);
      if (!styleClass) return; // not a revealable node type

      const { from, to } = node;
      decorations.push(revealMark(view, node, styleClass).range(from, to));

      if (node.type === Deco) {
        decorations.push(
          Decoration.widget({ widget: decorationBoundary, side: -1 }).range(from),
          Decoration.widget({ widget: decorationBoundary, side: 1 }).range(to),
        );
      }

      // A collapsed cursor at either edge of a decoration is outside it.
      // In particular, after moving right past a closing bracket, treating
      // `to` as touching reveals the closing mark and leaves the browser's
      // native caret inside the decoration's marked DOM. The zero-width
      // boundary widgets above then cannot isolate the following input.
      // Non-empty selections still count as touching when they overlap the
      // node, including when extended into it with shift+Arrow.
      const touching =
        node.type === Deco
          ? main.empty
            ? main.head > from && main.head < to
            : main.from < to && main.to > from
          : main.from <= to && main.to >= from;
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
