import {
  autocompletion,
  type Completion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { suggestTitles } from "@/lib/dexie/titleIndex";
import { skipContexts } from "./pasteMarkdown/context";

// An unclosed "[" followed by text without brackets, up to the cursor. In a
// nested "[* [ap" only the inner bracket matches.
const OPEN_BRACKET_RE = /\[([^[\]\n]*)$/;

// "[* text]" and "[/ text]" are decorations, not links.
const DECORATION_RE = /^[*/]+ /;

// A hashtag being typed: "#" at the start of the line or after whitespace,
// then at least one character. Mirrors the parser's hashtag boundary (see
// rules/hashTag.ts); brackets are excluded so "[* #ta" stays unambiguous.
const HASHTAG_RE = /(?:^|\s)#([^\s[\]]+)$/;

// Suggests the titles of existing cards while a wiki link ("[ap") or a hashtag
// ("#ap") is being typed. podId is read on every request, so it may still be
// unknown when the editor is created.
export function titleCompletion(podId: () => string | undefined) {
  // Shared by both sources: the pod is known, and the cursor is not in plain
  // text (the title line, code and inline code).
  const active = (state: Parameters<CompletionSource>[0]["state"]) =>
    podId() !== undefined && !skipContexts.some((skip) => skip.test(state));

  const linkSource: CompletionSource = async (context) => {
    const pod = podId();
    const match = context.matchBefore(OPEN_BRACKET_RE);
    if (!pod || !match || !active(context.state)) return null;

    const typed = match.text.slice(1);
    if (DECORATION_RE.test(typed)) return null;
    if (typed === "" && !context.explicit) return null;

    const titles = await suggestTitles(pod, typed);
    return {
      from: match.from + 1,
      // The query already filtered. CodeMirror's own filter would drop
      // matches where the title differs from the typed text (case, "_").
      filter: false,
      options: titles.map((title): Completion => ({
        label: title,
        // closeBrackets has usually inserted "]" already: step over it
        // instead of duplicating it.
        apply: (view, _completion, from, to) => {
          const closed = view.state.sliceDoc(to, to + 1) === "]";
          view.dispatch({
            changes: { from, to, insert: closed ? title : `${title}]` },
            selection: { anchor: from + title.length + 1 },
            userEvent: "input.complete",
          });
        },
      })),
    };
  };

  const tagSource: CompletionSource = async (context) => {
    const pod = podId();
    const match = context.matchBefore(HASHTAG_RE);
    if (!pod || !match || !active(context.state)) return null;

    // The group is the typed text after "#"; it is always at the match's end.
    const typed = match.text.slice(match.text.lastIndexOf("#") + 1);
    const titles = await suggestTitles(pod, typed);
    return {
      from: match.to - typed.length,
      filter: false,
      options: titles.map((title): Completion => ({
        label: title,
        // A hashtag ends at whitespace, so spaces become "_", which has the
        // same titleLc.
        apply: title.replaceAll(" ", "_"),
      })),
    };
  };

  return autocompletion({
    override: [linkSource, tagSource],
    icons: false,
    // Same look as the selection menu (see editorTheme.ts), above the caret.
    aboveCursor: true,
    tooltipClass: () => "title-completion",
  });
}
