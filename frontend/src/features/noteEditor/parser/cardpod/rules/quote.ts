import type { BlockContext, Line } from "@lezer/markdown";

import { parseLineBlock } from "./lineBlock";

// A deliberately small Phase 0 consumer of the shared line-block machinery.
// It also serves as the template for Helpfeel, CommandLine, and NumberList.
export function parseQuote(cx: BlockContext, line: Line): boolean {
  return parseLineBlock(cx, line, {
    kind: "quote",
    node: "quote",
    mark: "quoteMark",
    trimFollowingSpace: true,
  });
}
