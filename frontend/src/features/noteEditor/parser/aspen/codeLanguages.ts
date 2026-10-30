// Dynamic, per-language syntax highlighting for `code:` blocks
// (see rules/codeBlock.ts). Mirrors @codemirror/lang-markdown's own
// getCodeParser: language grammars are not bundled up front -- the
// language metadata after `code:` (e.g. `code:ts`) is looked up in
// @codemirror/language-data's catalog, and the matching parser
// package is only pulled in via a dynamic import() the first time
// that language is actually used. Until the import resolves, the
// block is parsed with ParseContext.getSkippingParser, which yields
// no tree for the content (so it renders as plain text) and schedules
// a reparse once the language finishes loading.
import type { Input, SyntaxNodeRef } from "@lezer/common";
import { parseMixed } from "@lezer/common";
import { LanguageDescription, ParseContext } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

const CODE_PREFIX_RE = /^\s*code:/;

// Reads a CodeBlock declaration. `code:file(lang)` explicitly selects lang;
// a bare value is also accepted as a language name, as in `code:typescript`.
function readInfo(node: SyntaxNodeRef, input: Input): string {
  const openMark = node.node.firstChild;
  if (!openMark) return "";
  const line = input.read(openMark.from, openMark.to);
  const meta = line.replace(CODE_PREFIX_RE, "").trim();
  const explicitLanguage = /\(([^()]+)\)$/.exec(meta)?.[1];
  return explicitLanguage?.trim() || meta;
}

// A CodeBlock has its declaration as its only child. Its raw code starts on
// the next line and runs to the end of the node.
function codeRange(node: SyntaxNodeRef) {
  const declaration = node.node.firstChild;
  if (!declaration || declaration.to >= node.to) return null;
  return { from: declaration.to + 1, to: node.to };
}

// Looks up `info` in @codemirror/language-data's catalog and returns
// a nested-parse descriptor for it, or null if no language matches or
// the block has no code content to nest into.
function nestCodeBlock(node: SyntaxNodeRef, input: Input) {
  if (node.name !== "CodeBlock") return null;

  const range = codeRange(node);
  if (!range) return null;

  const info = readInfo(node, input);
  if (!info) return null;

  const found = LanguageDescription.matchLanguageName(languages, info, true);
  if (!(found instanceof LanguageDescription)) return null;

  // Already loaded (e.g. an earlier code block used the same
  // language this session): parse with it directly.
  if (found.support) {
    return { parser: found.support.language.parser, overlay: [range] };
  }

  // Not loaded yet: kick off the dynamic import and, in the
  // meantime, parse this block with a parser that produces no tree.
  // ParseContext reparses the document once found.load() resolves,
  // at which point found.support is set and the branch above takes
  // over.
  return {
    parser: ParseContext.getSkippingParser(found.load()),
    overlay: [range],
  };
}

export const codeLanguageWrap = parseMixed(nestCodeBlock);
