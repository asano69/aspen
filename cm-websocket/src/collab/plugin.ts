import {
  collab,
  getSyncedVersion,
  receiveUpdates,
  sendableUpdates,
} from "@codemirror/collab";
import type { Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { Channel } from "../channel";
import {
  fromWire,
  toWire,
  type PushMessage,
  type UpdatesMessage,
} from "./protocol";

// Connects the editor to the server over `channel`. The document starts empty
// and is rebuilt by replaying the server's update history.
export function collabExtension(channel: Channel): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      private readonly view: EditorView;
      private readonly unsubscribe: (() => void)[];
      // True while a push is in flight; only one is allowed at a time.
      private pushing = false;

      constructor(view: EditorView) {
        this.view = view;
        this.unsubscribe = [
          channel.onOpen(this.push),
          channel.on<UpdatesMessage>("updates", this.onUpdates),
        ];
      }

      update(update: ViewUpdate) {
        if (update.docChanged) this.push();
      }

      destroy() {
        for (const off of this.unsubscribe) off();
      }

      private push = () => {
        const state = this.view.state;
        const updates = sendableUpdates(state);
        if (this.pushing || updates.length === 0) return;

        const msg: PushMessage = {
          type: "push",
          version: getSyncedVersion(state),
          updates: toWire(updates),
        };
        this.pushing = channel.send(msg);
      };

      private onUpdates = (msg: UpdatesMessage) => {
        const state = this.view.state;

        // Skip updates that were already applied.
        const skip = getSyncedVersion(state) - msg.from;
        if (skip < 0) {
          channel.close(4000, "editor is out of sync with the server");
          return;
        }

        this.pushing = false;
        const fresh = fromWire(msg.updates).slice(skip);
        if (fresh.length > 0) this.view.dispatch(receiveUpdates(state, fresh));
        // Retry anything that was rejected or typed in the meantime.
        this.push();
      };
    },
  );

  return [collab({ clientID: channel.clientID }), plugin];
}
