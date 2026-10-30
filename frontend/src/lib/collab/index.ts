// Public API of the collab client: a shared WebSocket channel and the
// @codemirror/collab extension that uses it.
export { Channel, connect, type Message } from "./channel";
export { collabExtension } from "./plugin";
