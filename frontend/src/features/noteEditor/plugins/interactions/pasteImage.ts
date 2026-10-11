import { EditorView } from "@codemirror/view";
import { skipContexts } from "./pasteMarkdown/context";

// MIME types the server can process (see internal/attachment). Supporting
// another format means adding it here and to the server's processors.
const SUPPORTED_TYPES = new Set(["image/png"]);

function findImage(data: DataTransfer | null): File | undefined {
  return Array.from(data?.files ?? []).find((file) =>
    SUPPORTED_TYPES.has(file.type),
  );
}

// Uploads a pasted image and inserts its URL in image notation ("[url]").
// `upload` resolves to the URL of the stored image. A paste without a
// supported image, or inside the title line or code, falls through to the
// default paste.
export function pasteImage(upload: (file: File) => Promise<string>) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const file = findImage(event.clipboardData);
      if (!file) return false;
      if (skipContexts.some((context) => context.test(view.state))) {
        return false;
      }

      event.preventDefault();
      upload(file)
        .then((url) => {
          // The caret may have moved while uploading: insert where it is now.
          const { head } = view.state.selection.main;
          const insert = `[${url}]`;
          view.dispatch({
            changes: { from: head, insert },
            selection: { anchor: head + insert.length },
            scrollIntoView: true,
            userEvent: "input.paste",
          });
        })
        .catch((err) => {
          console.error("[paste-image] failed to upload:", err);
          window.alert(
            err instanceof Error ? err.message : "Failed to upload the image.",
          );
        });
      return true;
    },
  });
}
