import type { InlineContext } from "@lezer/markdown";

// This is deliberately a structural dispatcher, modelled after cosy's
// parser/bracket.rs.  In particular, finding the matching bracket happens
// before deciding what its content means; adding another bracket notation
// therefore cannot change how nested brackets are paired.
export type BracketKind =
  | "Math"
  | "icon"
  | "ProjectLink"
  | "location"
  | "image"
  | "urlLink"
  | "imageLink"
  | "link";

type UrlKind = "image" | "link";

export interface BracketDecision {
  kind: BracketKind;
  // For labelled links and linked images, the first and last tokens are the
  // only URL candidates, exactly as in cosy's links_and_pages.rs.
  href?: string;
  src?: string;
  label?: string;
}

const ICON_RE = /^.+\.icon(?:\*[1-9]\d*)?$/u;
const PROJECT_RE = /^\/[^/]+(?:\/.*)?$/u;
const COORDINATE_RE = /^[NS]\d+(?:\.\d+)?,[EW]\d+(?:\.\d+)?(?:,Z\d+)?$/u;
const GYAZO_RE =
  /^https?:\/\/(?:[0-9a-z-]+\.)?gyazo\.com\/[0-9a-f]{32}(?:\/raw)?$/iu;
// Tested against the whole URL, not just its path, so that Scrapbox's
// "append .png" trick (e.g. "...?q=abc&s=10.png" or "...#.png") works.
// The extension may only be followed by a query or fragment.
const IMAGE_EXTENSION_RE =
  /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)(?:[?#].*)?$/iu;

// An uploaded attachment, written relative to the origin as
// "@/<recordId>/<filename>" so the notation survives a change of origin.
// Keep in sync with internal/parser/decide.go.
const ATTACHMENT_RE = /^@\/[a-z0-9]+\/[^\s/]+$/u;

function inferUrl(value: string): UrlKind | undefined {
  if (ATTACHMENT_RE.test(value) && IMAGE_EXTENSION_RE.test(value)) {
    return "image";
  }
  if (!value.includes("://") || !URL.canParse(value)) return undefined;
  const scheme = new URL(value).protocol; // "http:" | "https:" | "javascript:" ...
  if (scheme !== "http:" && scheme !== "https:") return undefined;
  return GYAZO_RE.test(value) || IMAGE_EXTENSION_RE.test(value)
    ? "image"
    : "link";
}
// Classifies the already-paired content of a single bracket. Keep this pure:
// it is the ambiguity boundary and is independently testable without Lezer.
export function decideBracketNodeType(content: string): BracketDecision {
  if (content.startsWith("$ ")) return { kind: "Math" };
  if (ICON_RE.test(content)) return { kind: "icon" };
  if (PROJECT_RE.test(content)) return { kind: "ProjectLink" };

  // Any ECMAScript whitespace separates tokens, like scrapbox-parser's
  // \s+ (a full-width space typed by an IME must work too). All such
  // characters are one UTF-16 unit, so "+ 1" below skips exactly one.
  const firstSpace = content.search(/\s/u);
  const first = firstSpace === -1 ? content : content.slice(0, firstSpace);
  const rest = firstSpace === -1 ? undefined : content.slice(firstSpace + 1);
  // The last whitespace is the one followed only by non-whitespace.
  const lastSpace = content.search(/\s(?=\S*$)/u);
  const last = lastSpace === -1 ? undefined : content.slice(lastSpace + 1);
  if (
    COORDINATE_RE.test(content) ||
    (first && COORDINATE_RE.test(first)) ||
    (last && COORDINATE_RE.test(last))
  ) {
    return { kind: "location" };
  }

  const firstKind = inferUrl(first ?? "");
  if (last === undefined) {
    if (firstKind === "image") return { kind: "image", src: first };
    if (firstKind === "link") return { kind: "urlLink", href: first };
    return { kind: "link" };
  }

  const lastKind = inferUrl(last);
  // A linked image requires exactly two URL tokens. For longer content,
  // `rest`/`start` are labels rather than URL candidates (cosy's rule).
  if (
    firstSpace === lastSpace &&
    firstKind &&
    lastKind &&
    (firstKind === "image" || lastKind === "image")
  ) {
    return firstKind === "image"
      ? { kind: "imageLink", src: first, href: last }
      : { kind: "imageLink", src: last, href: first };
  }
  if (firstKind === "link")
    return { kind: "urlLink", href: first, label: rest };
  if (lastKind)
    return {
      kind: "urlLink",
      href: last,
      label: content.slice(0, lastSpace),
    };
  return { kind: "link" };
}

function matchingBracket(cx: InlineContext, from: number): number {
  let depth = 0;
  for (let at = from; at < cx.end; at++) {
    const ch = cx.char(at);
    if (ch === 10) return -1;
    if (ch === 91) depth++;
    else if (ch === 93) {
      if (depth === 0) return at;
      depth--;
    }
  }
  return -1;
}

// `openEnd`/`closeStart` let a mark cover more than its bracket: a
// labelled ExternalLink stretches the mark on the URL's side over the
// URL itself, so syntaxReveal hides the URL and leaves only the label.
function marks(
  cx: InlineContext,
  node: string,
  from: number,
  to: number,
  children = [],
  openEnd = from + 1,
  closeStart = to - 1,
) {
  return cx.elt(node, from, to, [
    cx.elt(`${node}Mark`, from, openEnd),
    ...children,
    cx.elt(`${node}Mark`, closeStart, to),
  ]);
}

function parseSingleBracket(cx: InlineContext, pos: number): number {
  const end = matchingBracket(cx, pos + 1);
  if (end < 0) return -1;
  const contentFrom = pos + 1;
  const content = cx.slice(contentFrom, end);
  if (content === "") return -1;
  const decision = decideBracketNodeType(content);
  const to = end + 1;

  if (decision.kind === "link" || decision.kind === "ProjectLink") {
    return cx.addElement(marks(cx, decision.kind, pos, to));
  }
  if (
    decision.kind === "Math" ||
    decision.kind === "icon" ||
    decision.kind === "location" ||
    decision.kind === "image" ||
    decision.kind === "imageLink"
  ) {
    return cx.addElement(cx.elt(decision.kind, pos, to));
  }
  const label = decision.label;
  let children = [];
  let openEnd = pos + 1;
  let closeStart = end;
  if (label !== undefined) {
    const urlFirst = content.startsWith(decision.href!);
    const labelFrom = urlFirst
      ? contentFrom + decision.href!.length + 1
      : contentFrom;
    children = cx.parser.parseInline(label, labelFrom);
    // The mark on the URL's side also covers the URL and its space.
    if (urlFirst) openEnd = labelFrom;
    else closeStart = labelFrom + label.length;
  }
  return cx.addElement(
    marks(cx, "urlLink", pos, to, children, openEnd, closeStart),
  );
}

function parseStrong(cx: InlineContext, pos: number): number {
  // Pair the inner `[` with nested-depth tracking, then require the outer ].
  const innerEnd = matchingBracket(cx, pos + 2);
  if (innerEnd < 0 || cx.char(innerEnd + 1) !== 93 || innerEnd === pos + 2)
    return -1;
  const contentFrom = pos + 2;
  const content = cx.slice(contentFrom, innerEnd);
  const kind = decideBracketNodeType(content).kind;
  const child =
    kind === "image"
      ? "strongImage"
      : kind === "icon"
        ? "StrongIcon"
        : undefined;
  const children = child
    ? [cx.elt(child, contentFrom, innerEnd)]
    : cx.parser.parseInline(content, contentFrom);
  const to = innerEnd + 2;
  return cx.addElement(
    cx.elt("strong", pos, to, [
      cx.elt("strongMark", pos, contentFrom),
      ...children,
      cx.elt("strongMark", innerEnd, to),
    ]),
  );
}

export function parseBracket(
  cx: InlineContext,
  next: number,
  pos: number,
): number {
  if (next !== 91) return -1;
  return cx.char(pos + 1) === 91
    ? parseStrong(cx, pos)
    : parseSingleBracket(cx, pos);
}
