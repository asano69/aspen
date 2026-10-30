import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { BareUrl, ExternalLink } from "../../parser/aspen";
import { decideBracketNodeType } from "../../parser/aspen/rules/bracket";

// Makes an ExternalLink node ("[url]", "[url label]", or "[label url]")
// act as a real hyperlink: clicking anywhere inside the node opens its
// URL in a new tab. Mirrors wikiLinkNavigation.ts's own click handler
// for WikiLink nodes, but this one leaves the current tab untouched
// since the target is an external site, not another card.
//
// Fires unconditionally on any left click, without checking whether
// syntaxReveal is currently showing or hiding the node's marks --
// same as WikiLink, moving the cursor into the node's range via the
// keyboard still reveals its raw markup for editing independently of
// this handler.
// The class parser/aspen/index.ts's revealStyle gives ExternalLink and
// BareUrl nodes. Internal links use "page-link" instead, so this never
// matches a WikiLink.
const EXTERNAL_LINK_CLASS = "link";

export function externalLinkNavigation() {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0) return false; // left click only

      // See wikiLinkNavigation.ts's own comment: confirms the click
      // landed on the rendered span itself, not just on a document
      // position posAtCoords clipped into this node's range.
      const target = event.target as HTMLElement | null;
      if (!target?.closest(`.${EXTERNAL_LINK_CLASS}`)) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;

      let node = syntaxTree(view.state).resolve(pos, 1);
      while (node && node.type !== ExternalLink && node.type !== BareUrl) {
        node = node.parent;
      }
      if (!node) return false;

      // A bare URL's whole range is its href. For a bracketed link,
      // strip the surrounding "[" and "]" to recover the raw bracket
      // content, then reuse the same classification logic the parser
      // used to build this node (see rules/bracket.ts) -- its href is
      // not stored as a node attribute, only implied by its content.
      const href =
        node.type === BareUrl
          ? view.state.sliceDoc(node.from, node.to)
          : decideBracketNodeType(
              view.state.sliceDoc(node.from + 1, node.to - 1),
            ).href;
      if (!href) return false;

      event.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
      return true;
    },
  });
}
