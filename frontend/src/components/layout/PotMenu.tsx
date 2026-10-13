import { createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { Settings, Pencil, Trash2 } from "@/lib/icons";
import PromptDialog from "@/components/dialogs/PromptDialog";
import ConfirmDialog from "@/components/dialogs/ConfirmDialog";
import { removePot, renamePot } from "@/lib/stores/potsStore";

export interface PotMenuProps {
  id: string;
  title: string;
}

// Dropdown menu of the open pot, right of its name in the TopBar. Mirrors
// UserMenu: an icon-button trigger plus a list of actions. The dialogs are
// siblings of the menu, not children of its items, so they stay mounted
// after the menu closes.
export default function PotMenu(props: PotMenuProps) {
  const navigate = useNavigate();
  const [renameOpen, setRenameOpen] = createSignal(false);
  const [deleteOpen, setDeleteOpen] = createSignal(false);

  const handleRename = (title: string) => renamePot(props.id, title);

  // The pot is gone, so there is nothing left to show on its page.
  const handleDelete = async () => {
    await removePot(props.id);
    navigate("/");
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenu.Trigger aria-label="Pot actions" class="icon-btn">
          <Settings size={24} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="menu-content">
            <DropdownMenu.Item
              onSelect={() => setRenameOpen(true)}
              class="menu-item"
            >
              <Pencil size={16} />
              Rename
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => setDeleteOpen(true)}
              class="menu-item"
              data-destructive=""
            >
              <Trash2 size={16} />
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>

      <PromptDialog
        open={renameOpen()}
        onOpenChange={setRenameOpen}
        title="Rename pot"
        label="Title"
        initialValue={props.title}
        onSubmit={handleRename}
        errorMessage="Failed to rename the pot."
      />
      {/* Deleting a pot cascade-deletes every card inside it, so this is
          confirmed before it happens. */}
      <ConfirmDialog
        open={deleteOpen()}
        onOpenChange={setDeleteOpen}
        title="Delete pot"
        description="This will permanently delete this pot and all its cards."
        onConfirm={handleDelete}
        confirmLabel="Delete"
        submittingLabel="Deleting…"
        errorMessage="Failed to delete the pot."
      />
    </>
  );
}
