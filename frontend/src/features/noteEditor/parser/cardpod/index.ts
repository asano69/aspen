// Cardpod syntax is parsed by @lezer/markdown's line-oriented block
// pipeline. Its CommonMark parsers are all removed below: we retain only the
// incremental block/inline infrastructure and install Cardpod's own grammar.
import {
  Language,
  LanguageSupport,
  defineLanguageFacet,
} from "@codemirror/language";
import { NodeType } from "@lezer/common";
import { parser } from "@lezer/markdown";

import { codeLanguageWrap } from "./codeLanguages";
import { hideContent, isIndent, isMark, revealStyle } from "./nodeProps";
import { parseBareUrl } from "./rules/bareUrl";
import { parseBlank } from "./rules/blank";
import { parseBracket } from "./rules/bracket";
import { parseDecoration } from "./rules/decoration";
import { parseCodeBlock } from "./rules/codeBlock";
import { parseHashTag } from "./rules/hashTag";
import { parseInlineCode } from "./rules/inlineCode";
import { startsIndentedBlock } from "./rules/indentedBlock";
import { parseParagraph } from "./rules/paragraph";
import { parseQuote } from "./rules/quote";
import { parseTable } from "./rules/table";
import { parseTitle } from "./rules/title";

export { hideContent, isIndent, isMark, revealStyle };

// Names of @lezer/markdown's own parsers, which are not Cardpod node names.
// They must stay exactly as the library spells them (e.g. "InlineCode",
// "Image"), or `remove` silently stops removing them.
const defaultParsers = [
  "LinkReference",
  "IndentedCode",
  "FencedCode",
  "Blockquote",
  "HorizontalRule",
  "BulletList",
  "OrderedList",
  "ATXHeading",
  "HTMLBlock",
  "SetextHeading",
  "Escape",
  "Entity",
  "InlineCode",
  "HTMLTag",
  "Emphasis",
  "HardBreak",
  "Link",
  "Image",
] as const;

// `Paragraph` deliberately remains. It is the neutral leaf block provided by
// the markdown infrastructure and is where Cardpod's inline parsers run.
const cardpodParser = parser.configure({
  remove: defaultParsers,
  defineNodes: [
    { name: "Title", block: true },
    { name: "CodeBlock", block: true },
    "CodeBlockMark",
    { name: "Table", block: true },
    "TableMark",
    { name: "TableRow", block: true },
    "TableCell",
    { name: "quote", block: true },
    "quoteMark",
    "deco",
    "decoMark",
    "code",
    "codeMark",
    "link",
    "linkMark",
    "urlLink",
    "urlLinkMark",
    "image",
    "imageLink",
    "icon",
    "ProjectLink",
    "ProjectLinkMark",
    "location",
    "Math",
    "strong",
    "strongMark",
    "strongImage",
    "StrongIcon",
    "hashTag",
    "url",
    "blank",
    "blankMark",
    "indent",
  ],
  props: [
    revealStyle.add({
      // deco also gets one "deco-<char>" class per decoration character
      // (see syntaxReveal.ts and decoClasses.ts), so this class only marks
      // the node as revealable. Class names follow Cosense's own DOM:
      // "strong" is "[[x]]", "page-link" is an internal link and "link" is
      // an external one.
      deco: "deco",
      code: "code highlight",
      link: "page-link",
      urlLink: "link",
      ProjectLink: "page-link",
      strong: "strong",
      hashTag: "page-link",
      // No marks, so nothing is ever hidden: this only styles the URL.
      url: "link",
      // Its marks are the brackets, so only the whitespace shows (the class
      // has no styling of its own).
      blank: "blank",
      // Whole-line node, not a delimiter pair: only the leading ">"
      // is an isMark child (see rules/quote.ts), so syntaxReveal
      // hides just that prefix while the cursor is elsewhere on the
      // line -- the same live-preview behavior as every other
      // revealable node here.
      quote: "quote",
      // Image/LinkedImage have no mark children of their own (see
      // rules/bracket.ts), so this class only ever shows while the
      // cursor is actively editing the raw "[url]" text -- see the
      // hideContent registration below for what happens otherwise.
      image: "image",
      imageLink: "image",
    }),
    isMark.add({
      decoMark: true,
      codeMark: true,
      linkMark: true,
      urlLinkMark: true,
      ProjectLinkMark: true,
      strongMark: true,
      quoteMark: true,
      blankMark: true,
    }),
    isIndent.add({
      indent: true,
    }),
    // Image/LinkedImage's raw bracketed URL is only shown while the
    // cursor touches it; otherwise it's hidden entirely, since the
    // actual image is already rendered as a widget (see
    // imageWidget.ts) and the raw text would just be noise.
    hideContent.add({
      image: true,
      imageLink: true,
    }),
  ],
  parseBlock: [
    // Must stay first: the title line is plain text, so no other block rule
    // may see it (see rules/title.ts).
    { name: "CardpodTitle", parse: parseTitle },
    {
      name: "CardpodCodeBlock",
      parse: parseCodeBlock,
      endLeaf: (_, line) => startsIndentedBlock(line, "code:") !== null,
    },
    {
      name: "CardpodTable",
      parse: parseTable,
      endLeaf: (_, line) => startsIndentedBlock(line, "table:") !== null,
    },
    { name: "CardpodQuote", parse: parseQuote },
    { name: "CardpodParagraph", parse: parseParagraph },
  ],
  parseInline: [
    { name: "CardpodDecoration", parse: parseDecoration },
    { name: "CardpodBlank", parse: parseBlank },
    { name: "CardpodBracket", parse: parseBracket },
    { name: "CardpodInlineCode", parse: parseInlineCode },
    { name: "CardpodHashTag", parse: parseHashTag },
    { name: "CardpodBareUrl", parse: parseBareUrl },
  ],
  // Nests a `code:` block's content in whatever language its metadata
  // (e.g. "code:ts") resolves to, loaded on demand -- see
  // codeLanguages.ts.
  wrap: codeLanguageWrap,
});

function node(name: string): NodeType {
  const type = cardpodParser.nodeSet.types.find(
    (candidate) => candidate.name === name,
  );
  if (!type) throw new Error(`Cardpod parser is missing its ${name} node type`);
  return type;
}

// Export the exact node identities used by the configured parser. Consumers
// compare these by identity when decorating or navigating syntax nodes.
export const Deco = node("deco");
export const DecoMark = node("decoMark");
export const Code = node("code");
export const CodeMark = node("codeMark");
export const WikiLink = node("link");
export const WikiLinkMark = node("linkMark");
export const ExternalLink = node("urlLink");
export const ExternalLinkMark = node("urlLinkMark");
export const Image = node("image");
export const LinkedImage = node("imageLink");
export const Icon = node("icon");
export const ProjectLink = node("ProjectLink");
export const ProjectLinkMark = node("ProjectLinkMark");
export const GoogleMap = node("location");
export const Math = node("Math");
export const Strong = node("strong");
export const StrongMark = node("strongMark");
export const StrongImage = node("strongImage");
export const StrongIcon = node("StrongIcon");
export const HashTag = node("hashTag");
export const BareUrl = node("url");
export const Blank = node("blank");
export const CodeBlock = node("CodeBlock");
export const CodeBlockMark = node("CodeBlockMark");
export const Table = node("Table");
export const TableMark = node("TableMark");
export const TableRow = node("TableRow");
export const TableCell = node("TableCell");
export const Indent = node("indent");
export const Title = node("Title");

const cardpodLanguageData = defineLanguageFacet({});

export const cardpodSyntaxLanguage = new Language(
  cardpodLanguageData,
  cardpodParser,
  [],
  "cardpod",
);

export function cardpodSyntax(): LanguageSupport {
  return new LanguageSupport(cardpodSyntaxLanguage);
}
