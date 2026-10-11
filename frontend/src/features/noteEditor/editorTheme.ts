import { EditorView } from "@codemirror/view";
import {
  INDENT_WIDTH_PX,
  DOT_SIZE_PX,
} from "./plugins/decorations/hangingIndent";

// All CodeMirror-specific styling lives here via EditorView.theme(),
// not as plain CSS in styles/components/*.css. CodeMirror injects its
// own base theme as unlayered runtime <style>, and per the CSS
// Cascade Layers spec, unlayered rules always beat rules inside
// `@layer components` regardless of selector specificity -- so CSS
// there would need !important just to apply at all. Keeping every
// CodeMirror override in one EditorView.theme() avoids that fight
// entirely and keeps components/*.css focused on this app's own
// classes, not a third-party editor's internals.
//
// CSS custom properties from styles/theme.css (var(--color-*), etc.)
// work the same way here as in plain CSS, so this still shares the
// same design tokens as the rest of the app.
export const editorTheme = EditorView.theme({
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-editor)",
    // The page scrolls, not the editor, so nothing needs clipping here. With
    // the default "overflow: auto", a remote name flag at the right edge of a
    // wrapped line (it extends rightwards from the caret) was cut off instead
    // of showing in the page's padding.
    overflow: "visible",
  },
  ".cm-content": {
    padding: "0",
  },
  // Telomere gutter (see plugins/decorations/telomere.ts). Taken out of the
  // flow and placed in the page's left padding (.page's 49px, see
  // styles/components.css), so the text does not move. Colors follow
  // Cosense's variables, with its own defaults.
  ".cm-gutters": {
    position: "absolute",
    top: "0",
    left: "-49px",
    backgroundColor: "transparent",
    border: "none",
  },
  ".cm-telomere": {
    width: "20px",
  },
  ".telomere-border": {
    boxSizing: "border-box",
    height: "100%",
    cursor: "pointer",
    borderLeft: "5px solid var(--telomere-border)",
  },
  ".telomere-border.unread": {
    borderLeftColor: "var(--telomere-unread)",
  },
  ".telomere-border.updated": {
    borderLeftColor: "var(--telomere-updated)",
  },
  // Caret, drawn by drawSelection() (see index.tsx). CodeMirror's base theme
  // makes it black and only lightens it under "&dark", which this theme does
  // not declare, so it is unreadable in dark mode. The text color token
  // follows the current mode.
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--page-text-color)",
  },
  // Selection color, drawn by drawSelection() (see index.tsx). The focused
  // focused selector is needed because CodeMirror's base theme sets
  // its own (purple) color for the focused state, which would
  // otherwise win over the plain selector.
  ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
    {
      backgroundColor: "green",
      opacity: "0.4",
    },
  // drawSelection() sets the layer's z-index itself, so !important is
  // needed to stack the selection above the text and its backgrounds.
  // pointer-events: none keeps clicks reaching the text underneath.
  ".cm-selectionLayer": {
    zIndex: "1 !important",
    pointerEvents: "none",
  },

  // Remote cursors (y-codemirror.next): a 2px green caret with a small green
  // name flag above it. Its base theme only shows the flag while the caret is
  // hovered; it is always shown here.
  ".cm-ySelectionCaret": {
    opacity: "0.7",
  },

  ".cm-ySelectionCaretDot": {
    display: "none",
  },
  ".cm-ySelectionInfo": {
    opacity: "1",
    top: "-7px",
    width: "50px",
    height: "14px",
    padding: "0 2px",
    fontFamily: "var(--font-sans)",
    fontSize: "10px",
    lineHeight: "14px",
    color: "#fff",
    backgroundColor: "green",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    overflow: "hidden",
    // The flag sits inside a ".cm-line", whose hanging indent
    // (".cm-line.indent") sets a negative text-indent and whose baseline sets
    // word-break: break-all. Both are inherited and would shift the name left
    // (cutting off its first characters) or break it, so they are reset here.
    textIndent: "0",
    wordBreak: "normal",
  },

  // Flags of collaborators outside the visible area (see
  // plugins/decorations/outsideCursors.ts). Positioned in screen
  // coordinates, so they are fixed.
  ".shared-cursors": {
    pointerEvents: "none",
  },
  ".shared-cursors .cursor": {
    position: "fixed",
    zIndex: "101",
    width: "2px",
    height: "20px",
    opacity: "0.7",
    backgroundColor: "green",
  },
  ".shared-cursors .user-flag": {
    marginTop: "-7px",
    width: "50px",
    height: "14px",
    padding: "0 2px",
    fontFamily: "var(--font-sans)",
    fontSize: "10px",
    lineHeight: "14px",
    color: "#fff",
    backgroundColor: "green",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    overflow: "hidden",
  },
  ".shared-cursors .cursor.outside-top, .shared-cursors .cursor.outside-bottom":
    {
      zIndex: "1001",
      opacity: "0.3",
    },
  ".shared-cursors .cursor.outside-top .user-flag": {
    marginTop: "7px",
  },
  ".shared-cursors .cursor.outside-bottom .user-flag": {
    marginTop: "-7px",
  },

  ".cm-line": {
    lineHeight: "1.7",
    fontSize: "15px",
    // Baseline: any boundary in the line is breakable, including the
    // boundary next to an atomic non-text inline element (a
    // hanging-indent "pad" widget today, or a future inline image).
    // wordBreak.ts then marks ordinary short text runs back to
    // word-break: normal, so this only actually applies to long
    // unbroken runs and widget boundaries. See wordBreak.ts's own
    // comment for the full rationale.
    wordBreak: "break-all",
  },
  ".cm-line.line-title": {
    fontFamily: "var(--font-editor)",
    fontSize: "1.73rem",
    color: "var(--line-title-color)",
    // A fixed unitless-looking px value, not "normal" -- matches the
    // line's own calc(1em + 1rem) elsewhere so an empty title line
    // and a text-filled one report the same caret height.
    lineHeight: "42px",
    paddingBottom: "21px",
  },
  // A line carrying a leading indent run (see hangingIndent.ts's
  // buildDecorations): the total indent width is passed in as the
  // --indent-width CSS variable via an inline style on the line
  // itself. margin-left reserves that width for every visual row of
  // the line (including wrapped continuation rows); the matching
  // negative text-indent then cancels margin-left back out for just
  // the first visual row, since that row's own width is already
  // reserved by the pad elements below.
  ".cm-line.indent": {
    marginLeft: "var(--indent-width, 0px)",
    textIndent: "calc(-1 * var(--indent-width, 0px))",
  },
  // A `code:` body line. The declaration's own indent
  // (--code-outer-width, see hangingIndent.ts) is a transparent border that
  // the background does not paint (background-clip: padding-box); the rest
  // of the indent is padding, so the block's own indent level is drawn with
  // the code background and wrapped rows hang inside it. The negative
  // text-indent above still cancels the whole indent for the first row,
  // where the pad widgets sit. The declaration line is excluded: it is an
  // ordinary bullet line.
  ".cm-line.indent.code-block:not(.start)": {
    marginLeft: "0",
    borderLeft: "var(--code-outer-width, 0px) solid transparent",
    paddingLeft:
      "calc(var(--indent-width, 0px) - var(--code-outer-width, 0px))",
    backgroundClip: "padding-box",
  },
  // One indent level's mark box (see hangingIndent.ts's
  // IndentMarkWidget), replacing the underlying whitespace character
  // 1:1. Fixed-width and non-editable so it renders and behaves like
  // a single character rather than like ordinary text content.
  ".pad": {
    position: "relative",
    display: "inline-block",
    width: `${INDENT_WIDTH_PX}px`,
    // Explicit 1em height, matching the text's own font box rather
    // than the taller line-height box (1.7, see .cm-line above), so
    // the dot's top:50% centering below lines up with the glyphs'
    // actual vertical center.
    height: "1em",
    lineHeight: "1",
    verticalAlign: "middle",
  },
  // Bullet dot drawn inside a line's last pad only (see
  // IndentMarkWidget's `hasDot`), centered within that mark's box.
  ".pad .dot": {
    position: "absolute",
    display: "block",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: `${DOT_SIZE_PX}px`,
    height: `${DOT_SIZE_PX}px`,
    borderRadius: "50%",
    backgroundColor: "var(--page-text-color)",
  },

  // Menu shown above a selection (see plugins/interactions/selectionMenu.ts).
  ".cm-tooltip.selection-menu": {
    display: "flex",
    gap: "2px",
    padding: "2px",
    border: "1px solid var(--color-border)",
    borderRadius: "6px",
    backgroundColor: "var(--card-bg)",
    boxShadow: "var(--shadow-popover)",
  },
  ".selection-menu button": {
    padding: "4px 8px",
    borderRadius: "4px",
    fontFamily: "var(--font-sans)",
    fontSize: "13px",
    color: "var(--page-text-color)",
    cursor: "pointer",
  },
  ".selection-menu button:hover:not(:disabled)": {
    backgroundColor: "var(--color-hover-bg)",
  },
  ".selection-menu button:disabled": {
    opacity: "0.4",
    cursor: "not-allowed",
  },

  // Title suggestions while a wiki link or hashtag is typed (see
  // plugins/interactions/titleCompletion.ts). The box matches
  // ".cm-tooltip.selection-menu" above; the options are a vertical list. The
  // ".cm-tooltip-autocomplete" part is needed to win over CodeMirror's base
  // theme, which colors the selected option blue.
  ".cm-tooltip.cm-tooltip-autocomplete.title-completion": {
    padding: "2px",
    border: "1px solid var(--color-border)",
    borderRadius: "6px",
    backgroundColor: "var(--card-bg)",
    boxShadow: "var(--shadow-popover)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete.title-completion > ul": {
    fontFamily: "var(--font-sans)",
    fontSize: "13px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete.title-completion > ul > li": {
    padding: "4px 8px",
    borderRadius: "4px",
    color: "var(--page-text-color)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete.title-completion > ul > li[aria-selected]":
    {
      backgroundColor: "var(--color-hover-bg)",
      color: "var(--page-text-color)",
    },

  // "[[x]]" (Strong node).
  ".strong": {
    fontWeight: "bold",
  },

  // Bold notation ("[* x]", "[** x]", ...): the number of asterisks picks
  // the level class (see syntaxReveal.ts's strongLevel). Level 1 is plain
  // bold; higher levels also grow the font and the line height. The "*" in
  // the class name is escaped for the CSS selector.
  ".deco-\\*": {
    fontWeight: "bold",
  },
  ".deco-\\*.level-2": { fontSize: "1.2em", lineHeight: "28px" },
  ".deco-\\*.level-3": { fontSize: "1.44em", lineHeight: "35px" },
  ".deco-\\*.level-4": { fontSize: "1.73em", lineHeight: "42px" },
  ".deco-\\*.level-5": { fontSize: "2.07em", lineHeight: "49px" },
  ".deco-\\*.level-6": { fontSize: "2.49em", lineHeight: "56px" },
  ".deco-\\*.level-7": { fontSize: "3em", lineHeight: "63px" },
  ".deco-\\*.level-8": { fontSize: "3.58em", lineHeight: "77px" },
  ".deco-\\*.level-9": { fontSize: "4.3em", lineHeight: "91px" },
  ".deco-\\*.level-10": { fontSize: "5.16em", lineHeight: "105px" },

  // Italic notation ("[/ x]"); "/" is escaped for the CSS selector.
  ".deco-\\/": {
    fontStyle: "italic",
  },

  // Inline code span (see parser/cardpot's Code node): a monospace
  // font plus GitHub's own subtle code-background tint.
  ".code.highlight": {
    fontFamily: "var(--font-mono)",
    backgroundColor:
      "light-dark(rgba(175, 184, 193, 0.2), rgba(110, 118, 129, 0.4))",
    borderRadius: "6px",
    padding: "0.15em 0.35em",
    fontSize: "90%",
    color: "#342d9c", //--code-color
  },

  // `code:` block (see codeBlockLines.ts): every line the block
  // spans gets this class via Decoration.line, which fills the
  // line's full width -- including blank lines and the gap past the
  // last character -- unlike an inline Decoration.mark.
  ".cm-line.code-block": {
    fontFamily: "var(--font-mono)",
    backgroundColor:
      "light-dark(rgba(175, 184, 193, 0.2), rgba(110, 118, 129, 0.4))",
    fontSize: "90%",
    padding: "0px",
  },
  // The declaration line ("code: python") has no full-width background;
  // only its declaration text is highlighted, via ".code-block-start".
  ".cm-line.code-block.start": {
    backgroundColor: "transparent",
    fontSize: "0.95em",
  },
  // The background must stay translucent: the selection is drawn in a
  // layer beneath the text, so an opaque background would hide it.
  ".code-block-start": {
    color: "#342d9c",
    fontSize: "0.95em",
    backgroundColor: "#ffcfc6",
    padding: "1px 2px",
  },

  // Rendered diagram of a `code:mermaid` block (see mermaidBlock.ts).
  // The container is the positioning context of the pan/zoom controls. Its
  // width follows the editor and its height follows its width through the
  // diagram's aspect ratio (set in mermaidBlock.ts), so svg-pan-zoom always
  // has a box to fit into. minHeight cancels the SDK's own 320px minimum;
  // maxHeight keeps a tall diagram from filling the screen. Mermaid puts an
  // inline max-width on the svg, so overriding it needs !important.
  ".mermaid-block": {
    position: "relative",
    overflow: "hidden",
    minHeight: "0",
    maxHeight: "80vh",
  },
  ".mermaid-block svg": {
    width: "100%",
    height: "100%",
    maxWidth: "none !important",
  },
  // Pan/zoom controls of mermaid-diagram-pan-zoom. Its colors come from the
  // --ifm-* variables mapped in theme/default.css; only the size is reduced
  // here (the SDK draws 32px buttons). The SDK's stylesheet is unlayered, so
  // these rules win through the scope prefix EditorView.theme adds.
  ".mermaid-copy-btn, .mermaid-expand-btn, .mermaid-zoom-btn": {
    width: "24px",
    height: "24px",
    boxShadow: "var(--shadow-card)",
  },
  ".mermaid-copy-btn svg, .mermaid-expand-btn svg, .mermaid-zoom-btn svg": {
    width: "16px",
    height: "16px",
  },
  // The copy button sits at right: 8px; the expand button follows it.
  ".mermaid-expand-btn": {
    right: "40px",
  },
  ".mermaid-zoom-controls": {
    gridTemplateColumns: "repeat(3, 24px)",
    gridTemplateRows: "repeat(3, 24px)",
    gap: "3px",
  },
  ".mermaid-zoom-controls > span": {
    minWidth: "24px",
    minHeight: "24px",
  },
  ".mermaid-block.mermaid-error": {
    color: "#dc3545",
    fontFamily: "var(--font-mono)",
    fontSize: "90%",
    whiteSpace: "pre-wrap",
  },

  // WikiLink node (see parser/cardpot's WikiLink node and
  // wikiLinkNavigation.ts): styled like the old ProseMirror editor's
  // autolinks (see components.css's ".ProseMirror a") so it reads as
  // clickable.
  ".page-link, .link": {
    color: "var(--page-link-color)",
    cursor: "pointer",
  },
  // External URLs (labelled, bracketed and bare) are underlined so they
  // read differently from internal links.
  ".link": {
    textDecoration: "underline",
  },

  // A wiki link whose target is not alive (see emptyLinks.ts). The
  // descendant selector covers the case where this mark ends up wrapping
  // the ".page-link" span instead of sitting inside it.
  ".empty-page-link, .empty-page-link .page-link": {
    color: "var(--empty-page-link-color)",
  },

  // HashTag shares ".page-link" above. Blank is an always visible syntax
  // node: its background makes it scannable without opting it into
  // syntaxReveal's hidden-mark flow.
  ".blank": {
    backgroundColor:
      "light-dark(rgba(234, 179, 8, 0.18), rgba(250, 204, 21, 0.24))",
    borderRadius: "3px",
  },

  // Quote (see parser/cardpot's Quote node and rules/quote.ts).
  // Italic + a muted color is enough to distinguish a quoted line
  // from ordinary text without a block-level treatment (this decoration
  // is a plain Decoration.mark over the whole line's range, not a
  // full-width line decoration like codeBlockLines.ts's code-block
  // background).
  ".quote": {
    fontStyle: "italic",
    color: "var(--page-text-color)",
  },
});
