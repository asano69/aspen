// Shared NodeProps and Rule/RuleMatch types used by every syntax rule
// in parser/cardpod (rules/bold.ts, rules/inlineCode.ts, ...). Kept in
// their own file, separate from index.ts, so a rule module can import
// these without creating a circular dependency with index.ts -- which
// in turn imports every rule module to assemble the `rules` array.
import { NodeProp } from "@lezer/common";

// Applied to a "container" node type (Bold, WikiLink, CodeBlock, ...)
// to mark it as revealable: shown as styled text with its delimiter
// marks hidden, until the cursor touches it, at which point the raw
// markup is shown instead. The prop's value is the CSS class applied
// to the node's full range at all times (see syntaxReveal.ts).
export const revealStyle = new NodeProp<string>();

// Applied to a delimiter/mark node type (BoldMark, WikiLinkMark, ...)
// so syntaxReveal.ts can find and hide it generically, without
// knowing which specific syntax it belongs to. A mark node that
// should stay visible even when the cursor isn't touching it (e.g.
// CodeBlockMark's `code:` declaration) simply omits this prop.
export const isMark = new NodeProp<true>();

// Applied to a node type whose entire source range should be hidden
// while the cursor isn't touching it, rather than just its delimiter
// marks. Image/LinkedImage nodes have no open/close mark children at
// all (see rules/bracket.ts) -- their raw "[url]" text is only useful
// while actively editing it, since the actual image is already shown
// separately as a widget (see imageWidget.ts). Nodes tagged with this
// prop have their whole range replaced with nothing instead of only
// hiding mark children (see syntaxReveal.ts).
export const hideContent = new NodeProp<true>();

// The indentation value is represented by an `Indent` child node's source
// range. A NodeProp cannot vary per individual tree node (it belongs to a
// NodeType), so this prop identifies those children while `to - from` provides
// the character-count depth.
export const isIndent = new NodeProp<true>();
