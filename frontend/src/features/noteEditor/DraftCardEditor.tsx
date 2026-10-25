import { createSignal } from "solid-js";
import type { EditorView } from "@codemirror/view";
import NoteEditor from "./index";
import RelatedCards from "@/pages/cards/RelatedCards";
import { createCard } from "@/lib/api/cardApi";
import type { TitleCandidate } from "@/lib/models/card";
import { mergeCards } from "@/lib/stores/cardsStore";

export interface DraftCardEditorProps {
  podId: () => string | undefined;
  podSlug: () => string;
  initialTitle?: string;
  onCreated: (
    cardId: string,
    text: string,
    selection: { anchor: number; head: number },
  ) => void;
}

// A draft is purely local: no connection to the server and nothing stored
// anywhere, so an abandoned draft leaves no trace. Once createCard succeeds,
// the draft's text is handed to ExistingCardEditor, which pushes it to the new
// card's room as its first edit.
export default function DraftCardEditor(props: DraftCardEditorProps) {
  const [saveError, setSaveError] = createSignal(false);
  let creating = false;
  let created = false;
  let view: EditorView | undefined;

  const create = async (candidate: TitleCandidate) => {
    if (creating || created) return;
    creating = true;
    try {
      const podId = props.podId();
      if (!podId) return;
      const result = await createCard(podId, candidate);
      mergeCards([result.card]);
      created = true;
      setSaveError(false);
      // Read after the request: the user may have kept typing or moved
      // the caret while it was in flight.
      const text = view?.state.doc.toString() ?? "";
      const { anchor, head } = view?.state.selection.main ?? {
        anchor: 0,
        head: 0,
      };
      props.onCreated(result.card.id, text, { anchor, head });
    } catch (error) {
      console.error("[draft-card-editor] failed to create card:", error);
      setSaveError(true);
    } finally {
      creating = false;
    }
  };

  return (
    <>
      {saveError() && (
        <p class="form-error">
          Failed to create this card. Your text is preserved in this session --
          edit the title again to retry.
        </p>
      )}
      <NoteEditor
        onView={(v) => (view = v)}
        podSlug={props.podSlug}
        initialTitle={props.initialTitle}
        // A draft seeded from a URL slug (a wiki link or the address bar)
        // is a page the user has not chosen to write yet, so nothing is
        // focused. Only an empty draft (the "add card" button) focuses
        // the editor, so typing can start immediately.
        autofocus={!props.initialTitle}
        onConfirmedTitle={create}
      >
        {/* Only a draft opened from a URL slug has a title, and only
            that title can already have incoming links. It is not
            refetched while the header is edited: once the card is
            created, ExistingCardEditor shows the relations instead. */}
        <RelatedCards title={props.initialTitle} podSlug={props.podSlug()} />
      </NoteEditor>
    </>
  );
}
