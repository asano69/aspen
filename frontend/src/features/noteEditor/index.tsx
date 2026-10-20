/* eslint-disable solid/reactivity --
   The editor is created once per mount: props are read during setup, and
   mountEditor is a ref callback, which the rule mistakes for a plain
   function used in JSX. */
import { createEffect, onCleanup, untrack, type JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { closeBrackets } from "@codemirror/autocomplete";
import { hangingIndent } from "./plugins/decorations/hangingIndent";
import { wordBreak } from "./plugins/decorations/wordBreak";
import { codeBlockLines } from "./plugins/decorations/codeBlockLines";
import { imageWidget } from "./plugins/decorations/imageWidget";
import { mermaidBlock } from "./plugins/decorations/mermaidBlock";
import { emptyLinks, setLinkAlive } from "./plugins/decorations/emptyLinks";
import { telomere, setTelomere } from "./plugins/decorations/telomere";
import { startTelomereClock, telomereNow } from "@/lib/stores/telomereStore";
import { createLineMeta } from "@/lib/stores/lineMetaStore";
import { unreadLineIdsOf } from "@/lib/stores/unreadStore";
import { telomereEntries } from "@/lib/models/telomere";
import { currentUser } from "@/lib/api/auth";
import { lineMetaWriter } from "./plugins/interactions/lineMetaWriter";
import { trailingBlankLine } from "./plugins/interactions/trailingBlankLine";
import {
  linkAlive,
  linkAliveVersion,
  requestLinkAlive,
} from "@/lib/stores/linkAliveStore";
import { usePot } from "@/pages/pots/PotContext";
import { yCollab } from "y-codemirror.next";
import { defaultKeymapGroups } from "./keymaps";
import { caretOnly } from "./awareness";
import { outsideCursors } from "./plugins/decorations/outsideCursors";
import * as Y from "yjs";
import type { WebsocketProvider } from "y-websocket";
import { titleCandidateExtension } from "./titleCandidatePlugin";
import { syntheticAnnotation } from "./userEdit";
import { titleLineHighlight } from "./plugins/decorations/titleLineHighlight";
import { editorTheme } from "./editorTheme";
import {
  indentUnit,
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { cardpodSyntax } from "./parser/cardpod";
import { syntaxReveal } from "./plugins/decorations/syntaxReveal";
import { wikiLinkNavigation } from "./plugins/interactions/wikiLinkNavigation";
import { externalLinkNavigation } from "./plugins/interactions/externalLinkNavigation";
import { pasteUrlDecode } from "./plugins/interactions/pasteUrlDecode";
import { pasteMarkdown } from "./plugins/interactions/pasteMarkdown";
import { pasteImage } from "./plugins/interactions/pasteImage";
import { uploadAttachment } from "@/lib/api/cardApi";
import { pasteCodeBlockIndent } from "./plugins/interactions/pasteCodeBlockIndent";
import { selectionMenu } from "./plugins/interactions/selectionMenu";
import { titleCompletion } from "./plugins/interactions/titleCompletion";
import type { TitleCandidate } from "@/lib/models/card";
import { registerDebugView } from "./debug";
import { imeDebug } from "./imeDebug";

export interface NoteEditorProps {
  ydoc: Y.Doc;
  // Id of the card, when it exists. Only used to look up its unread lines
  // (see lib/stores/unreadStore.ts); a draft has none.
  cardId?: string;
  provider?: WebsocketProvider;
  // True when ydoc was handed over from a draft: the line meta it already
  // holds is the user's own edits, so those lines start as "updated".
  draftHandoff?: boolean;
  potSlug: () => string;
  initialTitle?: string;
  autofocus?: boolean;
  existingTitle?: string;
  // Selection to restore (and focus the editor with) when this editor
  // mounts. Used only for the draft-to-existing-card transition (see
  // CardForm's focusSelection), so the caret stays exactly where the
  // user left it in the draft editor that this one replaces.
  initialSelection?: { anchor: number; head: number };
  // Called once with the created EditorView, so a caller can read the
  // live selection later (see DraftCardEditor).
  onView?: (view: EditorView) => void;
  onConfirmedTitle: (candidate: TitleCandidate) => void;
  // Called with the selected text when the user picks "Merge into existing
  // page" in the selection menu. Without it that menu item is disabled.
  onMergeSelection?: (text: string) => void;
  // Rendered below the editor, in the related-page-list section. The
  // caller decides what goes there, so the editor needs no card id.
  children?: JSX.Element;
}

// Rendering-only CodeMirror adapter. The caller owns the Y.Doc and every
// persistence/network provider, so lifecycle changes cannot alter its mode.
export default function NoteEditor(props: NoteEditorProps) {
  const navigate = useNavigate();
  const pot = usePot();
  const ytext = props.ydoc.getText("content");
  const handleSlugCandidate = (candidate: TitleCandidate) => {
    props.onConfirmedTitle(candidate);
  };
  // Solid doesn't auto-unmount ref callbacks the way React's new
  // ref-cleanup convention does, so `view.destroy()` is wired to
  // onCleanup explicitly below.
  const mountEditor = (el: HTMLDivElement) => {
    // Created before the editor: the line meta writer reports edits to it.
    const lineMeta = createLineMeta(
      props.ydoc,
      props.provider,
      props.draftHandoff,
    );

    // The doc always starts from `ytext`'s current content here --
    // for a brand-new card that's empty, for an existing one it's
    // whatever the room already holds. yCollab keeps this view and
    // `ytext` in sync afterward, and draws the remote cursors from the
    // provider's awareness. A draft has no provider, so it has no
    // awareness (and no remote cursors) either.
    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        EditorView.lineWrapping,
        // Debug-only IME logging (see imeDebug.ts).
        imeDebug(),
        // Draws the cursor/selection itself (via coordsAtPos) instead
        // of relying on the browser's native contenteditable caret.
        // Needed because IndentMarkWidget replaces an indent character
        // with a widget (see hangingIndent.ts): right after
        // Tab inserts a new widget, the native caret can render at a
        // stale layout position until the next reflow (e.g. another
        // keystroke or Shift-Tab) forces the browser to recompute it.
        // CodeMirror's own caret is computed fresh from the current
        // position mapping every time, so it never shows that lag.
        drawSelection(),
        // Auto-closes (), [], {}, '', "", `` and types over an
        // existing closer instead of duplicating it. Also handles
        // nested brackets on its own -- "[" twice in a row produces
        // "[[|]]" -- so this is what makes typing "[[Some Page]]"
        // (see cardpodSyntax.ts's WikiLink) feel natural, with no
        // custom handling needed for the double-bracket case.
        closeBrackets(),
        yCollab(
          ytext,
          props.provider ? caretOnly(props.provider.awareness) : null,
        ),
        // Flags of collaborators editing outside the visible area, pinned
        // to its top or bottom edge (see outsideCursors.ts). A draft has no
        // provider, so no collaborators either.
        props.provider
          ? outsideCursors(props.provider.awareness, props.ydoc, ytext)
          : [],
        titleCandidateExtension(handleSlugCandidate),
        titleLineHighlight,
        editorTheme,
        // Hanging indent for wrapped lines, and the Scrapbox/Cosense-
        // style bullet dot on a line's leading indent (see
        // hangingIndent.ts) -- each character of the parser's Indent
        // node is replaced 1:1 with a fixed-width "pad" element, so deleting
        // one behaves like deleting any other single character (no
        // separate atomic-range handling needed for that anymore).
        hangingIndent,
        // Controls how lines wrap (see wordBreak.ts / editorTheme.ts's
        // ".cm-line" rule): break-all is the baseline everywhere,
        // restoring normal word-boundary wrapping for ordinary short
        // runs, so neither a widget boundary nor a long unbroken run
        // forces an unnatural break elsewhere in the line.
        wordBreak,
        codeBlockLines,
        imageWidget,
        mermaidBlock,
        emptyLinks,
        // Edit-history bars left of each line (see
        // plugins/decorations/telomere.ts). Line ids come from `ytext`.
        telomere(ytext),
        // Records who edited each line last (see lineMetaWriter.ts).
        lineMetaWriter(props.ydoc, currentUser, lineMeta.touch),
        // Keeps a blank line at the end of the document (see
        // plugins/interactions/trailingBlankLine.ts).
        trailingBlankLine,
        // Suggests existing card titles while a wiki link is typed (see
        // plugins/interactions/titleCompletion.ts).
        titleCompletion(() => pot()?.id),
        // Cardpod's own Scrapbox-style syntax parser (see
        // parser/cardpod/index.ts): block notation (indentation, quotes,
        // `code:` and `table:` blocks) and inline notation (decorations,
        // links, images, hashtags, ...). syntaxReveal reads this same
        // syntax tree to decide when to hide/show the raw markup around
        // the cursor, Obsidian-style (see syntaxReveal.ts).
        cardpodSyntax(),
        // Colors tokens inside `code:` blocks once their
        // language has resolved (see parser/cardpod/codeLanguages.ts).
        syntaxHighlighting(defaultHighlightStyle),
        syntaxReveal,
        wikiLinkNavigation(props.potSlug, navigate),
        externalLinkNavigation(),
        pasteUrlDecode(),
        // Uploads a pasted image and inserts it as "[url]" (see
        // plugins/interactions/pasteImage.ts).
        pasteImage(uploadAttachment),
        // Converts pasted Markdown to Scrapbox notation (see
        // plugins/interactions/pasteMarkdown). Runs before
        // pasteCodeBlockIndent, which only sees pastes this one declines.
        pasteMarkdown(),
        // Keeps a multi-line paste inside a `code:` block from ending the
        // block (see pasteCodeBlockIndent.ts).
        pasteCodeBlockIndent(),
        // Menu above a selection: merge into another page, or copy as plain
        // text (see plugins/interactions/selectionMenu.ts).
        selectionMenu(props.onMergeSelection),
        // A single real tab character per indent level, not spaces --
        // indentMore/indentLess (bound below) both insert/remove
        // whatever this unit is. The parser itself accepts any
        // ECMAScript whitespace as indentation (see
        // parser/cardpod/indent.ts), so a tab is just the unit this
        // editor produces.
        indentUnit.of("\t"),
        // Every key binding, grouped by origin and ordered by
        // precedence (see keymaps.ts): Cardpod's own Tab/Enter/`/`*`
        // bindings win over the library keymaps that follow them,
        // since each group becomes its own keymap.of(...) extension
        // and CodeMirror's keymap() facet lets earlier extensions win
        // on a clash. yCollab's own yUndoManagerKeymap group is what
        // backs undo/redo here -- CM6's own history() extension is
        // deliberately not added, to avoid two undo stacks fighting
        // each other.
        ...defaultKeymapGroups.map((group) => keymap.of(group.bindings)),
      ],
    });

    const view = new EditorView({ state, parent: el });
    // Lets cardpodDebug.dumpTree() in the browser console find this editor.
    const unregisterDebug = registerDebugView(view);
    props.onView?.(view);

    // Feeds the shared link results (see lib/stores/linkAliveStore.ts) into
    // the editor as a predicate (see emptyLinks.ts). CodeMirror is outside
    // Solid's tracking, so this effect re-runs on the store's version signal
    // and sends a fresh predicate. The predicate runs untracked: it asks for a
    // result the first time it sees a link, and treats "not answered yet" as
    // alive so links never flash red.
    createEffect(() => {
      linkAliveVersion();
      const potId = pot()?.id;
      untrack(() =>
        view.dispatch({
          effects: setLinkAlive.of(
            potId
              ? (titleLc) => {
                  requestLinkAlive(potId, titleLc);
                  return linkAlive(potId, titleLc) ?? true;
                }
              : null,
          ),
        }),
      );
    });

    // Feeds the card's line meta, its unread and updated lines and the clock
    // into the editor (see plugins/decorations/telomere.ts). Like the
    // link-alive effect above, this re-runs on any change of those and sends
    // a fresh snapshot.
    onCleanup(startTelomereClock());
    createEffect(() => {
      const entries = telomereEntries(
        lineMeta.meta(),
        unreadLineIdsOf(props.cardId),
        lineMeta.updated(),
        currentUser()?.id,
      );
      const now = telomereNow();
      untrack(() =>
        view.dispatch({
          effects: setTelomere.of({ entries, now }),
        }),
      );
    });

    // Seed the document's first line with initialTitle for a
    // brand-new draft opened from a URL slug that matched no existing
    // card (see CardForm.tsx). Tagged with syntheticAnnotation so
    // titleCandidatePlugin doesn't treat this as a real user edit --
    // otherwise this programmatic seed alone would start (and, after
    // the debounce window, fire) the title-confirmation flow with no
    // actual user action, silently turning every "URL slug that
    // doesn't exist yet" visit into a real card. The header still
    // only resolves into a real "cards" record once the user actually
    // types, pastes, or presses Enter (see titleCandidatePlugin). No
    // focus is set here; that's left to the autofocus block below.
    if (props.initialTitle) {
      view.dispatch({
        changes: { from: 0, insert: props.initialTitle },
        annotations: syntheticAnnotation.of(true),
      });
    }

    // Autofocus into the editor only for a brand-new draft card, so
    // typing can start immediately. Opening an existing card leaves
    // focus untouched. Deferred to the next task: right after mount
    // the editor's DOM element may not be attached to the document
    // yet, which makes a synchronous focus() call silently do nothing.
    if (props.autofocus) {
      setTimeout(() => view.focus(), 0);
    }

    // Restores the caret (see initialSelection's own comment above) and
    // focuses the editor. Deferred to the next task for the same reason
    // autofocus is above -- right after mount the element may not be
    // attached to the document yet. Clamped to the document length in
    // case the content changed in the meantime.
    if (props.initialSelection) {
      setTimeout(() => {
        const max = view.state.doc.length;
        const { anchor, head } = props.initialSelection!;
        view.dispatch({
          selection: {
            anchor: Math.min(anchor, max),
            head: Math.min(head, max),
          },
        });
        view.focus();
      }, 0);
    }

    // Only fill the placeholder for a card whose server-confirmed
    // title is already "Untitled" (see cards.go's defaultTitle
    // fallback for an empty candidate). Gating on this synchronous,
    // already-known value -- instead of only checking whether the Yjs
    // doc *looks* empty once "sync" fires -- avoids a race where the
    // doc actually has content that simply hasn't synced to this
    // client yet: that content used to get misread as "still empty"
    // and clobbered with literal "Untitled" text. `provider` is only
    // set here for a card that was already an existing record when
    // this editor mounted (see connectProvider above), so this also
    // never runs for a card still being actively drafted. Only fires
    // once: the listener removes itself the first time it sees a
    // completed sync.
    let fillUntitledIfEmpty: (() => void) | undefined;
    if (props.provider && props.existingTitle === "Untitled") {
      fillUntitledIfEmpty = () => {
        props.provider?.off("sync", fillUntitledIfEmpty!);
        if (view.state.doc.line(1).text.trim() === "") {
          // Synthetic for the same reason as the initialTitle seed
          // above: this is a programmatic fill, not a user edit.
          view.dispatch({
            changes: { from: 0, insert: "Untitled" },
            annotations: syntheticAnnotation.of(true),
          });
        }
      };
      props.provider.on("sync", fillUntitledIfEmpty);
    }

    onCleanup(() => {
      if (fillUntitledIfEmpty) props.provider?.off("sync", fillUntitledIfEmpty);
      unregisterDebug();
      view.destroy();
    });
  };

  // The page's own look (padding, shadow, radius) lives in
  // styles/components.css's ".page". A card that has no provider yet is
  // still a draft with no record behind it, so it is marked
  // "not-persistent" and drawn faded until its title creates the card.
  return (
    <>
      <div class="page" classList={{ "not-persistent": !props.provider }}>
        <div ref={mountEditor} class="editor" />
      </div>
      {/* Reserves space below the editor so a long note's last line
          never lands flush against the bottom of the viewport --
          mirrors Cosense's own .related-page-list (see
          styles/components.css), including its class names, since
          this will eventually host the backlinks panel described in
          docs/wikilink-backlink-design.md. The toolbar is still
          unimplemented; the links container shows whatever children the
          caller passes. */}
      <section class="related-page-list">
        <div class="toolbar" />
        <div class="links-container">{props.children}</div>
      </section>
    </>
  );
}
