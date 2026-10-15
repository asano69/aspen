import { createSignal } from "solid-js";
import { useSortable } from "@dnd-kit/solid/sortable";
import { Pencil, Trash2 } from "@/lib/icons";
import { potCoverURL } from "@/lib/api/pots";
import ActionsMenu from "@/components/menus/ActionsMenu";
import PromptDialog from "@/components/dialogs/PromptDialog";
import ConfirmDialog from "@/components/dialogs/ConfirmDialog";
import { asCardTitle } from "@/lib/models/card";
import { removePot, renamePot } from "@/lib/stores/potsStore";
import type { PotRecord } from "@/lib/models/pot";
import { CardItemView } from "../cards/CardItem";

export interface PotItemProps {
  pot: PotRecord;
  // This pot's position in the rendered grid order, reported by dnd-kit on
  // drop (see PotCards.tsx's handleDragEnd).
  index: number;
}

// A pot shown as a card: the same view as a note card, with the pot's cover
// as its thumbnail and no description. Only what differs from a note lives
// here: where it links to, drag-to-reorder, and rename/delete.
export default function PotItem(props: PotItemProps) {
  // Getter syntax so the hook re-reads id/index reactively (same as CardItem).
  const { ref, isDragging } = useSortable({
    get id() {
      return props.pot.id;
    },
    get index() {
      return props.index;
    },
  });

  const [renameOpen, setRenameOpen] = createSignal(false);
  const [deleteOpen, setDeleteOpen] = createSignal(false);

  const card = () => ({
    title: asCardTitle(props.pot.title),
    description: [],
    image: potCoverURL(props.pot) ?? "",
  });

  return (
    <>
      <CardItemView
        card={card()}
        href={`/${props.pot.name}`}
        ref={ref}
        dragging={isDragging()}
        actions={
          <ActionsMenu
            label="Pot actions"
            items={[
              {
                label: "Rename",
                icon: Pencil,
                onSelect: () => setRenameOpen(true),
              },
              {
                label: "Delete",
                icon: Trash2,
                onSelect: () => setDeleteOpen(true),
                destructive: true,
              },
            ]}
          />
        }
      />
      <PromptDialog
        open={renameOpen()}
        onOpenChange={setRenameOpen}
        title="Rename pot"
        label="Title"
        initialValue={props.pot.title}
        onSubmit={(title) => renamePot(props.pot.id, title)}
        errorMessage="Failed to rename the pot."
      />
      {/* Deleting a pot cascade-deletes every card inside it, so this is
          confirmed before it happens. */}
      <ConfirmDialog
        open={deleteOpen()}
        onOpenChange={setDeleteOpen}
        title="Delete pot"
        description="This will permanently delete this pot and all its cards."
        onConfirm={() => removePot(props.pot.id)}
        confirmLabel="Delete"
        submittingLabel="Deleting…"
        errorMessage="Failed to delete the pot."
      />
    </>
  );
}
