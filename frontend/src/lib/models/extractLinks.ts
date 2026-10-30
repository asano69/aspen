import { IterMode } from "@lezer/common";

import {
  aspenSyntaxLanguage,
  HashTag,
  WikiLink,
} from "@/features/noteEditor/parser/aspen";
import { hashTagTitle } from "./hashTagTitle";
import { titleToLowerKey } from "./slugify";

export interface ExtractedLink {
  title: string;
  titleLc: string;
}

// Returns the distinct wiki links and hashtags of a full card text (title line
// included), in order of first appearance. Mirrors orderedTargets in
// internal/wikilink: a link's identity is its titleLc, the first spelling
// wins, and a link with an empty titleLc is dropped. Both sides are checked
// against testdata/link-extraction.json.
export function extractLinks(text: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();

  aspenSyntaxLanguage.parser.parse(text).iterate({
    // Code blocks are nested-language trees; they hold no links of ours.
    mode: IterMode.IgnoreMounts,
    enter(node) {
      if (node.type !== WikiLink && node.type !== HashTag) return;
      const raw = text.slice(node.from, node.to);
      const title =
        node.type === HashTag ? hashTagTitle(raw) : raw.slice(1, -1);
      const titleLc = titleToLowerKey(title);
      if (titleLc === "" || seen.has(titleLc)) return;
      seen.add(titleLc);
      links.push({ title, titleLc });
    },
  });
  return links;
}
