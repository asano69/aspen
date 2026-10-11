import {
  EditorView,
  Decoration,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Image, LinkedImage, StrongImage } from "../../parser/cardpot";
import { decideBracketNodeType } from "../../parser/cardpot/rules/bracket";
import { resolveImageSrc } from "@/lib/models/attachmentPath";
import { decorationPlugin } from "./decorationPlugin";

// Scrapbox distinguishes a plain image reference ("[url]") from its
// magnified "strong" form ("[[url]]"): the plain form is capped in
// both width and height, while the strong form is only capped in
// width and may grow as tall as its aspect ratio demands. Both
// preserve aspect ratio via plain max-width/max-height + auto sizing,
// no separate aspect-ratio math needed.
const IMAGE_MAX_WIDTH_PX = 862;
const IMAGE_MAX_HEIGHT_PX = 300;
const STRONG_IMAGE_MAX_WIDTH_PX = 819;

class ImageWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly strong: boolean,
  ) {
    super();
  }

  eq(other: ImageWidget) {
    return other.src === this.src && other.strong === this.strong;
  }

  toDOM() {
    const img = document.createElement("img");
    img.src = resolveImageSrc(this.src);
    img.alt = "";
    // Inline styles beat any stylesheet regardless of cascade layers,
    // so the width/height caps below need no separate theme entry
    // (unlike hangingIndent.ts/editorTheme.ts's other widgets).
    img.style.display = "block";
    img.style.width = "auto";
    img.style.height = "auto";
    img.style.maxWidth = `${
      this.strong ? STRONG_IMAGE_MAX_WIDTH_PX : IMAGE_MAX_WIDTH_PX
    }px`;
    if (!this.strong) {
      img.style.maxHeight = `${IMAGE_MAX_HEIGHT_PX}px`;
    }
    // Non-editable, so the widget behaves like a single atomic unit
    // rather than ordinary editable content (mirrors
    // hangingIndent.ts's IndentMarkWidget).
    img.contentEditable = "false";
    return img;
  }
}

// Recovers an Image/LinkedImage/StrongImage node's src. None of these
// store src as an attribute of their own (see rules/bracket.ts), so
// this re-derives it from the node's own source text -- mirroring
// externalLinkNavigation.ts's own approach for ExternalLink hrefs.
//
// A StrongImage node's range is already just its bare URL text (see
// parseStrong in rules/bracket.ts, which never wraps it in its own
// [[ ]] marks); an Image/LinkedImage node's range still includes its
// [ ] pair.
function extractSrc(
  state: EditorState,
  from: number,
  to: number,
  strong: boolean,
): string | null {
  if (strong) return state.sliceDoc(from, to);
  const content = state.sliceDoc(from + 1, to - 1);
  return decideBracketNodeType(content).src ?? null;
}

// Replaces an Image/LinkedImage/StrongImage node's raw bracketed text
// with the actual rendered image, in place -- the same Obsidian-style
// live-preview behavior syntaxReveal.ts gives every other syntax node
// (see that file's `touching` check), just implemented separately
// here since the "hidden" state isn't blank: it's a real <img>
// element, not a CSS-styled span. While the caret is inside the
// node's own range, the replacement is skipped so the raw
// "[url]"/"[[url]]" text shows instead, so it stays editable.
function buildDecorations(view: EditorView): DecorationSet {
  const decorations = [];
  const { main } = view.state.selection;

  syntaxTree(view.state).iterate({
    enter(node) {
      const strong = node.type === StrongImage;
      if (node.type !== Image && node.type !== LinkedImage && !strong) return;

      const { from, to } = node;
      const touching = main.from <= to && main.to >= from;
      if (touching) return; // leave raw text visible for editing

      const src = extractSrc(view.state, from, to, strong);
      if (!src) return;

      decorations.push(
        Decoration.replace({
          widget: new ImageWidget(src, strong),
        }).range(from, to),
      );
    },
  });

  return Decoration.set(decorations, true);
}

// A ViewPlugin (not a StateField): the widget now replaces inline
// text rather than inserting a block decoration, so it's no longer
// subject to CodeMirror's "block decorations may not come from a
// plugin" restriction. Recomputing on selectionSet as well as
// docChanged is what drives the caret-enters-reveals-raw-text
// behavior -- mirrors syntaxReveal.ts's own triggers exactly.
export const imageWidget = decorationPlugin({
  build: buildDecorations,
  // A new syntax tree (e.g. after a background parse of a long
  // document) can add Image nodes that need their widget.
  shouldRebuild: (update) =>
    update.docChanged ||
    update.selectionSet ||
    syntaxTree(update.startState) !== syntaxTree(update.state),
});
