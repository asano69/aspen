import type { InlineContext } from "@lezer/markdown";

import { BARE_URL_RE } from "./bareUrl";
import { bracketContainsCode } from "./bracketCode";
import { decoContentStart, startsWithDeco } from "./decoration";
import { inNested, parseNested } from "./nested";

// A single bracket closes at its first "]": "[x [y]]" is the plain "[x "
// followed by the link "y". Classifying the content (decideBracketNodeType)
// is separate from pairing, so adding a notation cannot change how brackets
// pair. Keep in sync with internal/parser/bracket.go.
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
// Classifies the content of a single bracket. Keep this pure: it is the
// ambiguity boundary and is independently testable without Lezer.
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

// The "]" that closes a formula ("[$ ...]") whose content starts at `from`,
// counting nested brackets. Every other notation closes at its first "]".
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

// The first "]" at or after `from` on this line, or -1.
function firstClose(cx: InlineContext, from: number): number {
  for (let at = from; at < cx.end; at++) {
    const ch = cx.char(at);
    if (ch === 10) return -1;
    if (ch === 93) return at;
  }
  return -1;
}

// The last "]" of the run of "]" that contains `at`.
function lastOfRun(cx: InlineContext, at: number): number {
  while (at + 1 < cx.end && cx.char(at + 1) === 93) at++;
  return at;
}

interface SingleSpan {
  decision: BracketDecision;
  // The "]" that closes the bracket.
  close: number;
}

// Finds the "]" that closes the single bracket opening at `pos` and classifies
// its content. Returns undefined when the bracket is plain text.
//
// A single bracket closes at its first "]", so its content has no "[". The
// exception is an external link, whose label is plain text and may hold "[":
// "[https://e.com a [b]]". When its URL comes first, the link closes at the
// last "]" of the run.
function singleSpan(cx: InlineContext, pos: number): SingleSpan | undefined {
  const isMath = cx.char(pos + 1) === 36 /* $ */ && cx.char(pos + 2) === 32;
  let close = isMath ? matchingBracket(cx, pos + 1) : firstClose(cx, pos + 1);
  if (close < 0 || close === pos + 1) return undefined;

  let decision = decideBracketNodeType(cx.slice(pos + 1, close));
  if (
    !isMath &&
    cx.slice(pos + 1, close).includes("[") &&
    decision.kind !== "urlLink"
  ) {
    return undefined;
  }
  if (
    decision.kind === "urlLink" &&
    decision.label !== undefined &&
    cx.slice(pos + 1, close).startsWith(decision.href!)
  ) {
    close = lastOfRun(cx, close);
    decision = decideBracketNodeType(cx.slice(pos + 1, close));
  }
  return { decision, close };
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
  const span = singleSpan(cx, pos);
  if (!span) return -1;
  const { decision, close } = span;
  const to = close + 1;

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

  // An external link. Its label is plain text: nothing inside it is parsed.
  let openEnd = pos + 1;
  let closeStart = close;
  if (decision.label !== undefined) {
    const urlFirst = cx.slice(pos + 1, close).startsWith(decision.href!);
    // The mark on the URL's side also covers the URL and its space.
    if (urlFirst) openEnd = pos + 1 + decision.href!.length + 1;
    else closeStart = pos + 1 + decision.label.length;
  }
  return cx.addElement(marks(cx, "urlLink", pos, to, [], openEnd, closeStart));
}

// Returns the first "]" of the "]]" that closes a strong whose content starts
// at `from`, or -1. The closing "]]" is the last two "]" of a run of "]", so
// "[[a]]]" is the strong "a]". The content may hold links but no stray "["
// and no decoration.
function strongClose(cx: InlineContext, from: number): number {
  let i = from;
  while (i < cx.end) {
    const ch = cx.char(i);
    if (ch === 10) return -1;
    if (ch === 91) {
      if (decoContentStart(cx, i) >= 0) return -1;
      const span = singleSpan(cx, i);
      if (!span) return -1;
      i = span.close + 1;
    } else if (ch === 93) {
      const last = lastOfRun(cx, i);
      if (last > i) return last - 1;
      i++;
    } else if (ch === 104 /* h */) {
      // A URL may hold "[".
      const url = BARE_URL_RE.exec(cx.slice(i, cx.end));
      i += url ? url[0].length : 1;
    } else {
      i++;
    }
  }
  return -1;
}

function parseStrong(cx: InlineContext, pos: number): number {
  const contentFrom = pos + 2;
  const close = strongClose(cx, contentFrom);
  if (close <= contentFrom) return -1;
  const content = cx.slice(contentFrom, close);
  // "[[* a]]" is a decoration inside brackets, not a strong.
  if (startsWithDeco(content)) return -1;

  const kind = decideBracketNodeType(content).kind;
  const child =
    kind === "image"
      ? "strongImage"
      : kind === "icon"
        ? "StrongIcon"
        : undefined;
  const children = child
    ? [cx.elt(child, contentFrom, close)]
    : parseNested(cx, content, contentFrom);
  const to = close + 2;
  return cx.addElement(
    cx.elt("strong", pos, to, [
      cx.elt("strongMark", pos, contentFrom),
      ...children,
      cx.elt("strongMark", close, to),
    ]),
  );
}

export function parseBracket(
  cx: InlineContext,
  next: number,
  pos: number,
): number {
  // A bracket containing a code span is plain text (see bracketCode.ts).
  if (next !== 91 || bracketContainsCode(cx, pos)) return -1;
  if (!inNested() && cx.char(pos + 1) === 91) {
    const strong = parseStrong(cx, pos);
    if (strong >= 0) return strong;
  }
  return parseSingleBracket(cx, pos);
}
