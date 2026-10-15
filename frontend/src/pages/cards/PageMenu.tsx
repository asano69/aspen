import { createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import ActionsMenu from "@/components/menus/ActionsMenu";
import QueryDialog from "@/components/dialogs/QueryDialog";
import { getSyntaxTreeJson } from "@/features/noteEditor/debug";
import { Trash2, Pin, Wrench, Funnel } from "@/lib/icons";
import { cardsById, removeCard, setCardQuery } from "@/lib/stores/cardsStore";

export interface PageMenuProps {
  // Id of the open card. Undefined for a draft, which has no record to
  // pin or delete yet, so every button is disabled.
  cardId: string | undefined;
  potSlug: string;
  // Keeps the menu's space but hides it (see CardForm's editorReady).
  hidden: boolean;
  // Getter for the open card's live Yjs text (see ExistingCardEditor's
  // onContentSnapshot). Undefined until the editor has registered it.
  getContent: (() => string) | undefined;
}

// Opens `blob` in a new tab. The URL is revoked well after a normal page
// load, since revoking immediately can race the new tab's read of it in
// some browsers.
function openBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Sticky vertical menu to the right of the editor: the open card's
// pin/delete/query actions and the debug dropdown.
export default function PageMenu(props: PageMenuProps) {
  const navigate = useNavigate();
  const [queryOpen, setQueryOpen] = createSignal(false);

  const card = () => (props.cardId ? cardsById[props.cardId] : undefined);
  const query = () => card()?.query ?? "";

  const handleDelete = async () => {
    const id = props.cardId;
    if (!id) return;
    await removeCard(id);
    navigate(`/${props.potSlug}`);
  };

  const saveQuery = async (value: string) => {
    const id = props.cardId;
    if (id) await setCardQuery(id, value);
  };

  // Debug helper: opens the card's raw Yjs text (plain text, not the
  // rendered editor view) in a new tab. charset=utf-8 must be explicit:
  // without it the browser guesses the encoding when rendering the tab and
  // can misread non-ASCII text (e.g. Japanese) as mojibake.
  const showRawText = () => {
    if (!props.getContent) return;
    openBlob(
      new Blob([props.getContent()], { type: "text/plain;charset=utf-8" }),
    );
  };

  // Debug helper: opens the current editor's syntax tree (see
  // features/noteEditor/debug.ts) as JSON in a new tab.
  const dumpSyntaxTree = () => {
    const json = getSyntaxTreeJson();
    if (!json) return;
    openBlob(
      new Blob([JSON.stringify(json, null, 2)], {
        type: "application/json;charset=utf-8",
      }),
    );
  };

  return (
    <div class="page-menu" data-hidden={props.hidden ? "" : undefined}>
      {/* Pinning is not implemented yet; the button only keeps its place. */}
      <button type="button" aria-label="Pin" class="tool-btn" disabled>
        <Pin size={22} />
      </button>
      <button
        type="button"
        aria-label="Delete"
        class="tool-btn"
        disabled={!props.cardId}
        onClick={handleDelete}
      >
        <Trash2 size={22} />
      </button>
      <button
        type="button"
        aria-label="Edit query"
        class="tool-btn"
        disabled={!props.cardId}
        onClick={() => setQueryOpen(true)}
      >
        <Funnel size={22} />
      </button>
      {/* Debug-only dropdown: exports either the card's raw Yjs text or its
          parsed syntax tree as a blob in a new tab. */}
      <ActionsMenu
        label="Debug options"
        triggerClass="tool-btn"
        disabled={!props.cardId}
        items={[
          { label: "Show raw text", icon: Wrench, onSelect: showRawText },
          { label: "Dump syntax tree", icon: Wrench, onSelect: dumpSyntaxTree },
        ]}
      />
      <QueryDialog
        open={queryOpen()}
        onOpenChange={setQueryOpen}
        initialValue={query()}
        onSubmit={saveQuery}
      />
    </div>
  );
}
