import type { InlineContext } from "@lezer/markdown";

// Inside a decoration or a strong neither of them can start again: "[* [* a]]"
// is a decoration holding the link "* a". Lezer rules cannot be given
// context, so parseNested marks the (synchronous) nested parse and the rules
// ask inNested().
let depth = 0;

export function inNested(): boolean {
  return depth > 0;
}

// Parses `text` (which starts at `offset` in the document) as the content of a
// decoration or a strong.
export function parseNested(cx: InlineContext, text: string, offset: number) {
  depth++;
  try {
    return cx.parser.parseInline(text, offset);
  } finally {
    depth--;
  }
}
