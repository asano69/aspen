/* eslint-disable solid/reactivity --
   This component is keyed by cardId (see CardForm), so it is remounted per
   card and its props are intentionally read once during setup. */
import { createEffect, onCleanup } from "solid-js";
import type { EditorView } from "@codemirror/view";
import { connect } from "@/lib/collab";
import NoteEditor from "./index";
import RelatedCards from "@/pages/cards/RelatedCards";
import type { TitleCandidate } from "@/lib/models/card";
import { extractLinks } from "@/lib/models/extractLinks";
import { authToken } from "@/lib/api/auth";
import { fetchTelomere } from "@/lib/api/cardApi";
import { telomereEntries } from "@/lib/models/telomere";
import { setTelomereBase } from "./plugins/decorations/telomere";
import { cardsById } from "@/lib/stores/cardsStore";
import { closeOwnLinks, setOwnLinks } from "@/lib/stores/relatedStore";

// Wait this long after the last edit before the open card's links are
// extracted again.
const LINKS_DEBOUNCE_MS = 300;

export interface ExistingCardEditorProps {
  cardId: string;
  podSlug: () => string;
  // The text of the draft this card was just created from, if any. The room
  // of a new card is empty, so it is pushed as the first edit.
  initialText?: string;
  // Forwarded straight to NoteEditor (see its own initialSelection comment).
  initialSelection?: { anchor: number; head: number };
  // Called once, synchronously, with a getter for this card's current text --
  // used by CardForm's debug "info" button to export a readable snapshot of
  // the live document. Not reactive: the returned string reflects whatever the
  // editor holds at the moment the getter is actually invoked.
  onContentSnapshot?: (getContent: () => string) => void;
  // Reports whether the editor is shown yet. Reported false again when this
  // editor goes away, so the caller never keeps a stale "ready".
  onReady?: (ready: boolean) => void;
}

// Existing cards own the connection to their collab room. The server watches
// the room's text and resolves+persists the title itself (see
// internal/serve/rooms.go); that update reaches this client through the shared
// "cards" realtime subscription (see lib/stores/cardsStore.ts).
//
// There is no reconnection yet: when the connection drops (including at token
// expiry) the editor stays on its last text until the card is reopened.
export default function ExistingCardEditor(props: ExistingCardEditorProps) {
  // A browser WebSocket cannot send an Authorization header, so the token goes
  // in the query string (see internal/serve/collab_auth.go).
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const channel = connect(
    `${protocol}//${location.host}/collab/${props.cardId}?token=${encodeURIComponent(authToken())}`,
  );

  let view: EditorView | undefined;
  const currentText = () => view?.state.doc.toString() ?? "";
  props.onContentSnapshot?.(currentText);

  // Loads who edited each line and which lines are unread (see
  // internal/serve/telomere.go). The editor applies it as soon as its text has
  // arrived and has the same number of lines.
  let closed = false;
  fetchTelomere(props.cardId)
    .then((response) => {
      if (closed || !view) return;
      view.dispatch({
        effects: setTelomereBase.of(telomereEntries(response.lines)),
      });
    })
    .catch((err) => console.error("[telomere] failed to load:", err));

  // The editor is shown at once: the room's text fills it as it arrives.
  createEffect(() => props.onReady?.(true));

  // Kept only because NoteEditor requires an onConfirmedTitle callback --
  // resolution itself happens server-side, so there is nothing left to do here
  // on confirm.
  const confirm = (_candidate: TitleCandidate) => {};

  // Keeps the related view's links of the open card in step with the live
  // text. An empty text means nothing has arrived yet, so it is skipped
  // instead of wiping the links read from the replica; the first update of
  // the room changes the document anyway.
  let linksTimer: ReturnType<typeof setTimeout> | undefined;
  const updateOwnLinks = () => {
    const text = currentText();
    const pod = cardsById[props.cardId]?.pod;
    if (text === "" || !pod) return;
    setOwnLinks(props.cardId, pod, extractLinks(text));
  };
  const scheduleOwnLinks = () => {
    clearTimeout(linksTimer);
    linksTimer = setTimeout(updateOwnLinks, LINKS_DEBOUNCE_MS);
  };

  onCleanup(() => {
    closed = true;
    clearTimeout(linksTimer);
    props.onReady?.(false);
    closeOwnLinks(props.cardId);
    channel.close(1000, "editor closed");
  });

  return (
    <NoteEditor
      channel={channel}
      onView={(v) => (view = v)}
      onDocChanged={scheduleOwnLinks}
      podSlug={props.podSlug}
      onConfirmedTitle={confirm}
      initialText={props.initialText}
      initialSelection={props.initialSelection}
    >
      <RelatedCards cardId={props.cardId} title={cardsById[props.cardId]?.title} podSlug={props.podSlug()} />
    </NoteEditor>
  );
}
