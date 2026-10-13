import type { SyntaxNode } from "@lezer/common";

import { cardpotSyntaxLanguage, isMark } from "../noteEditor/parser/cardpot";
import { decideBracketNodeType } from "../noteEditor/parser/cardpot/rules/bracket";
import type { DescriptionSegment } from "./types";

// A card description has no title line (the server drops it, see
// buildPreview in internal/serve/ydoc.go), but the parser always treats
// a document's first line as a plain-text title. A dummy title line is
// put in front so that the real first line is parsed like any other.
const DUMMY_TITLE = "T\n";

// Nodes whose children are walked; their own marks are stripped.
const CONTAINERS = new Set([
  "Document",
  "Paragraph",
  "quote",
  "Table",
  "TableRow",
  "TableCell",
  "deco",
  "strong",
]);

// Image nodes are dropped: the card's thumbnail (card.image) shows them.
const IMAGES = new Set(["image", "imageLink", "strongImage"]);

function push(out: DescriptionSegment[], segment: DescriptionSegment) {
  if (segment.text === "") return;
  const last = out[out.length - 1];
  if (segment.kind === "text" && last?.kind === "text") {
    last.text += segment.text;
  } else {
    out.push(segment);
  }
}

// The text between a node's opening and closing one-character marks.
function inner(doc: string, node: SyntaxNode): string {
  return doc.slice(node.from + 1, node.to - 1);
}

function walk(node: SyntaxNode, doc: string, out: DescriptionSegment[]) {
  let pos = node.from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    push(out, { kind: "text", text: doc.slice(pos, child.from) });
    pos = child.to;

    const name = child.type.name;
    if (name === "Title") {
      pos++; // also skip the newline after the dummy title
    } else if (name === "quoteMark") {
      if (doc[pos] === " ") pos++;
    } else if (name === "link") {
      push(out, { kind: "wikilink", text: inner(doc, child) });
    } else if (name === "urlLink") {
      const { href, label } = decideBracketNodeType(inner(doc, child));
      push(out, { kind: "external-link", text: label ?? href ?? "" });
    } else if (name === "code") {
      push(out, { kind: "inline-code", text: inner(doc, child) });
    } else if (name === "url") {
      const url = doc.slice(child.from, child.to);
      push(out, { kind: "external-link", text: url });
    } else if (name === "hashTag") {
      push(out, { kind: "hashtag", text: doc.slice(child.from, child.to) });
    } else if (IMAGES.has(name) || child.type.prop(isMark)) {
      // Dropped.
    } else if (CONTAINERS.has(name)) {
      walk(child, doc, out);
    } else {
      // Unsupported notation (Math, Icon, Blank, ...) stays as source text.
      push(out, { kind: "text", text: doc.slice(child.from, child.to) });
    }
  }
  push(out, { kind: "text", text: doc.slice(pos, node.to) });
}

// Turns a card description (raw Cardpot text, title line excluded) into
// flat segments: decorations (bold, italic, ...) and image notation are
// stripped, wiki links, external links, hashtags and inline code are
// kept as their own segments. Pure: knows nothing about the DOM.
export function parseDescription(text: string): DescriptionSegment[] {
  const doc = DUMMY_TITLE + text;
  const out: DescriptionSegment[] = [];
  walk(cardpotSyntaxLanguage.parser.parse(doc).topNode, doc, out);
  return out;
}
