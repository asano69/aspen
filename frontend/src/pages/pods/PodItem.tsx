import { createSignal } from "solid-js";
import { useSortable } from "@dnd-kit/solid/sortable";
import { Pencil, Trash2 } from "@/lib/icons";
import { podCoverURL } from "@/lib/api/pods";
import ActionsMenu from "@/components/menus/ActionsMenu";
import PromptDialog from "@/components/dialogs/PromptDialog";
import ConfirmDialog from "@/components/dialogs/ConfirmDialog";
import { asCardTitle } from "@/lib/models/card";
import { removePod, renamePod } from "@/lib/stores/podsStore";
import type { PodRecord } from "@/lib/models/pod";
import { CardItemView } from "../cards/CardItem";

export interface PodItemProps {
  pod: PodRecord;
  // This pod's position in the rendered grid order, reported by dnd-kit on
  // drop (see PodCards.tsx's handleDragEnd).
  index: number;
}

// A pod shown as a card: the same view as a note card, with the pod's cover
// as its thumbnail and no description. Only what differs from a note lives
// here: where it links to, drag-to-reorder, and rename/delete.
export default function PodItem(props: PodItemProps) {
  // Getter syntax so the hook re-reads id/index reactively (same as CardItem).
  const { ref, isDragging } = useSortable({
    get id() {
      return props.pod.id;
    },
    get index() {
      return props.index;
    },
  });

  const [renameOpen, setRenameOpen] = createSignal(false);
  const [deleteOpen, setDeleteOpen] = createSignal(false);

  const card = () => ({
    title: asCardTitle(props.pod.title),
    description: [],
    image: podCoverURL(props.pod) ?? "",
  });

  return (
    <>
      <CardItemView
        card={card()}
        href={`/${props.pod.name}`}
        ref={ref}
        dragging={isDragging()}
        actions={
          <ActionsMenu
            label="Pod actions"
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
        title="Rename pod"
        label="Title"
        initialValue={props.pod.title}
        onSubmit={(title) => renamePod(props.pod.id, title)}
        errorMessage="Failed to rename the pod."
      />
      {/* Deleting a pod cascade-deletes every card inside it, so this is
          confirmed before it happens. */}
      <ConfirmDialog
        open={deleteOpen()}
        onOpenChange={setDeleteOpen}
        title="Delete pod"
        description="This will permanently delete this pod and all its cards."
        onConfirm={() => removePod(props.pod.id)}
        confirmLabel="Delete"
        submittingLabel="Deleting…"
        errorMessage="Failed to delete the pod."
      />
    </>
  );
}
