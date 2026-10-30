import { countIndent } from "../../parser/aspen/indent";

// An explicit language in trailing parentheses, as in "main.rs(rust)".
// Mirrors codeLanguages.ts's readInfo.
const EXPLICIT_LANGUAGE_RE = /\(([^()]+)\)$/;

// Returns the language of a `code:` declaration line: the text in trailing
// parentheses when present, otherwise everything after "code:".
export function declarationLanguage(declaration: string): string {
  const meta = declaration
    .slice(countIndent(declaration))
    .replace(/^code:/, "")
    .trim();
  return EXPLICIT_LANGUAGE_RE.exec(meta)?.[1].trim() || meta;
}

// Returns the diagram source of a `code:` block (its full text, declaration
// line included), or null when the block is not a mermaid block. Only the
// block's own indent level (declaration indent + 1 character) is removed from
// each body line, like internal/parser's CodeBlock Body.
export function mermaidSource(blockText: string): string | null {
  const [declaration, ...body] = blockText.split("\n");
  if (declarationLanguage(declaration).toLowerCase() !== "mermaid") {
    return null;
  }
  const drop = countIndent(declaration) + 1;
  return body.map((line) => line.slice(drop)).join("\n");
}
