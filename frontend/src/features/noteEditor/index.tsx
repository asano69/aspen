/* eslint-disable solid/reactivity --
   The editor is created once per mount: props are read during setup, and
   mountEditor is a ref callback, which the rule mistakes for a plain
   function used in JSX. */
import {
  createEffect,
  createSignal,
  onCleanup,
  untrack,
  type JSX,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { closeBrackets } from "@codemirror/autocomplete";
import { collabExtension, cursorsExtension, type Channel } from "cm-websocket";
import { hangingIndent } from "./plugins/decorations/hangingIndent";
import { wordBreak } from "./plugins/decorations/wordBreak";
import { codeBlockLines } from "./plugins/decorations/codeBlockLines";
import { telomere } from "./plugins/decorations/telomere";
import { imageWidget } from "./plugins/decorations/imageWidget";
import { mermaidBlock } from "./plugins/decorations/mermaidBlock";
import { emptyLinks, setLinkAlive } from "./plugins/decorations/emptyLinks";
import { trailingBlankLine } from "./plugins/interactions/trailingBlankLine";
import {
  linkAlive,
  linkAliveVersion,
  requestLinkAlive,
} from "@/lib/stores/linkAliveStore";
import { usePot } from "@/pages/pots/PotContext";
import { currentUser } from "@/lib/api/auth";
import { defaultKeymapGroups } from "./keymaps";
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
import TelomerePopover, { type TelomereSelection } from "./TelomerePopover";
import { registerDebugView } from "./debug";
import { imeDebug } from "./imeDebug";

export interface NoteEditorProps {
  // Connection to the card's collab room. A draft has none, so it is a plain
  // local editor until its card is created.
  channel?: Channel;
  potSlug: () => string;
  initialTitle?: string;
  // Text to insert as the very first edit. Used for the draft-to-existing-card
  // transition: the card's room starts empty, and the text typed while
  // drafting is pushed to it like any other edit.
  initialText?: string;
  autofocus?: boolean;
  // Selection to restore (and focus the editor with) when this editor
  // mounts. Used only for the draft-to-existing-card transition (see
  // CardForm's focusSelection), so the caret stays exactly where the
  // user left it in the draft editor that this one replaces.
  initialSelection?: { anchor: number; head: number };
  // Called once with the created EditorView, so a caller can read the
  // live text or selection later.
  onView?: (view: EditorView) => void;
  // Called after every change of the document, whoever made it.
  onDocChanged?: () => void;
  onConfirmedTitle: (candidate: TitleCandidate) => void;
  // Called with the selected text when the user picks "Merge into existing
  // page" in the selection menu. Without it that menu item is disabled.
  onMergeSelection?: (text: string) => void;
  // Rendered below the editor, in the related-page-list section. The
  // caller decides what goes there, so the editor needs no card id.
  children?: JSX.Element;
}

// Rendering-only CodeMirror adapter. The caller owns the connection, so
// lifecycle changes cannot alter this editor's mode.
export default function NoteEditor(props: NoteEditorProps) {
  const navigate = useNavigate();
  const pot = usePot();
  // The telomere bar whose info popover is open (see TelomerePopover.tsx).
  const [telomereSelection, setTelomereSelection] =
    createSignal<TelomereSelection>();
  const handleSlugCandidate = (candidate: TitleCandidate) => {
    props.onConfirmedTitle(candidate);
  };
  // Solid doesn't auto-unmount ref callbacks the way React's new
  // ref-cleanup convention does, so `view.destroy()` is wired to
  // onCleanup explicitly below.
  const mountEditor = (el: HTMLDivElement) => {
    // The document always starts empty: with a channel, the room's update
    // history is replayed into it (see cm-websocket's collabExtension).
    const state = EditorState.create({
      doc: "",
      extensions: [
        EditorView.lineWrapping,
        // Debug-only IME logging (see imeDebug.ts).
        imeDebug(),
        // Draws the cursor/selection itself (via coordsAtPos) instead
        // of relying on the browser's native contenteditable caret.
        // Needed because IndentMarkWidget replaces an indent character
        // with a widget (see hangingIndent.ts): right after
        // Tab inserts a new widget, the native caret can render at a
        // stale layout position until the next reflow forces the browser
        // to recompute it.
        drawSelection(),
        // Auto-closes (), [], {}, '', "", `` and types over an existing
        // closer instead of duplicating it. Also handles nested brackets
        // on its own -- "[" twice in a row produces "[[|]]".
        closeBrackets(),
        // Undo/redo. @codemirror/collab keeps the history correct across
        // remote updates (receiveUpdates tags them as not undoable).
        history(),
        // Live editing with the server and the other editors' cursors. The
        // cursors extension must come after the collab one.
        ...(props.channel
          ? [
              collabExtension(props.channel),
              cursorsExtension(props.channel, {
                name: currentUser()?.name ?? "anonymous",
              }),
            ]
          : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) props.onDocChanged?.();
        }),
        titleCandidateExtension(handleSlugCandidate),
        titleLineHighlight,
        editorTheme,
        // Hanging indent for wrapped lines, and the Scrapbox/Cosense-
        // style bullet dot on a line's leading indent (see
        // hangingIndent.ts) -- each character of the parser's Indent
        // node is replaced 1:1 with a fixed-width "pad" element, so deleting
        // one behaves like deleting any other single character.
        hangingIndent,
        // Controls how lines wrap (see wordBreak.ts / editorTheme.ts's
        // ".cm-line" rule).
        wordBreak,
        // Bar left of each line: who edited it and whether it is unread (see
        // plugins/decorations/telomere.ts).
        telomere(
          () => currentUser()?.name ?? "",
          (entry, anchor) => setTelomereSelection({ entry, anchor }),
        ),
        codeBlockLines,
        imageWidget,
        mermaidBlock,
        emptyLinks,
        // Keeps a blank line at the end of the document (see
        // plugins/interactions/trailingBlankLine.ts).
        trailingBlankLine,
        // Suggests existing card titles while a wiki link is typed (see
        // plugins/interactions/titleCompletion.ts).
        titleCompletion(() => pot()?.id),
        // Cardpod's own Scrapbox-style syntax parser (see
        // parser/cardpod/index.ts). syntaxReveal reads this same syntax tree
        // to decide when to hide/show the raw markup around the cursor,
        // Obsidian-style (see syntaxReveal.ts).
        cardpodSyntax(),
        // Colors tokens inside `code:` blocks once their language has
        // resolved (see parser/cardpod/codeLanguages.ts).
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
        // indentMore/indentLess (bound below) both insert/remove whatever
        // this unit is. The parser itself accepts any ECMAScript whitespace
        // as indentation (see parser/cardpod/indent.ts).
        indentUnit.of("\t"),
        // Every key binding, grouped by origin and ordered by precedence
        // (see keymaps.ts): Cardpod's own bindings win over the library
        // keymaps that follow them, since each group becomes its own
        // keymap.of(...) extension.
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

    // Seed the document's first line with initialTitle for a brand-new draft
    // opened from a URL slug that matched no existing card (see CardForm.tsx).
    // Tagged with syntheticAnnotation so titleCandidatePlugin doesn't treat
    // this as a real user edit -- otherwise this programmatic seed alone would
    // start the title-confirmation flow with no actual user action, silently
    // turning every "URL slug that doesn't exist yet" visit into a real card.
    // The same goes for initialText below.
    if (props.initialTitle) {
      view.dispatch({
        changes: { from: 0, insert: props.initialTitle },
        annotations: syntheticAnnotation.of(true),
      });
    }

    // The text of the draft this editor replaces. The collab extension pushes
    // it to the card's (still empty) room like any other edit.
    if (props.initialText) {
      view.dispatch({
        changes: { from: 0, insert: props.initialText },
        annotations: syntheticAnnotation.of(true),
      });
    }

    // Autofocus into the editor only for a brand-new draft card, so typing can
    // start immediately. Deferred to the next task: right after mount the
    // editor's DOM element may not be attached to the document yet, which
    // makes a synchronous focus() call silently do nothing.
    if (props.autofocus) {
      setTimeout(() => view.focus(), 0);
    }

    // Restores the caret (see initialSelection's own comment above) and
    // focuses the editor. Deferred for the same reason autofocus is. Clamped
    // to the document length in case the content changed in the meantime.
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

    onCleanup(() => {
      unregisterDebug();
      view.destroy();
    });
  };

  // The page's own look (padding, shadow, radius) lives in
  // styles/components/page.css's ".page". An editor with no channel is still
  // a draft with no record behind it, so it is marked "not-persistent" and
  // drawn faded until its title creates the card.
  return (
    <>
      <div class="page" classList={{ "not-persistent": !props.channel }}>
        <div ref={mountEditor} class="editor" />
      </div>
      <TelomerePopover
        selection={telomereSelection()}
        onClose={() => setTelomereSelection(undefined)}
      />
      {/* Reserves space below the editor so a long note's last line never
          lands flush against the bottom of the viewport -- mirrors Cosense's
          own .related-page-list. The links container shows whatever children
          the caller passes. */}
      <section class="related-page-list">
        <div class="toolbar" />
        <div class="links-container">{props.children}</div>
      </section>
    </>
  );
}
