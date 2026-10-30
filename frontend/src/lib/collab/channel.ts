// Every message on the connection is a JSON object with a type.
export interface Message {
  type: string;
}

type Handler = (msg: Message) => void;

// WebSocket.OPEN, spelled out so that the module does not need the global.
const OPEN = 1;

function parse(data: string): Message | null {
  try {
    const msg = JSON.parse(data);
    return typeof msg?.type === "string" ? msg : null;
  } catch {
    return null;
  }
}

// One WebSocket shared by all extensions. A message is parsed once and handed
// to the handlers registered for its type, in the order they were registered.
export class Channel {
  readonly socket: WebSocket;
  // Identifies this editor to the server and to the other clients.
  readonly clientID = Math.random().toString(36).slice(2);
  private readonly handlers = new Map<string, Set<Handler>>();

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", this.onMessage);
  }

  // Calls `handler` for every message of `type`. Returns the function that
  // stops the calls.
  on<T extends Message>(
    type: T["type"],
    handler: (msg: T) => void,
  ): () => void {
    const set = this.handlers.get(type) ?? new Set<Handler>();
    this.handlers.set(type, set);
    set.add(handler as Handler);
    return () => set.delete(handler as Handler);
  }

  // Calls `handler` when the connection opens. Returns the function that stops
  // the calls.
  onOpen(handler: () => void): () => void {
    this.socket.addEventListener("open", handler);
    return () => this.socket.removeEventListener("open", handler);
  }

  // Sends `msg`. Returns false, sending nothing, while the connection is not
  // open.
  send(msg: Message): boolean {
    if (this.socket.readyState !== OPEN) return false;
    this.socket.send(JSON.stringify(msg));
    return true;
  }

  close(code: number, reason: string) {
    this.socket.close(code, reason);
  }

  private onMessage = (event: MessageEvent<string>) => {
    const msg = parse(event.data);
    if (!msg) {
      this.close(
        4001,
        "the server sent a message that is not a typed JSON object",
      );
      return;
    }
    for (const handler of this.handlers.get(msg.type) ?? []) handler(msg);
  };
}

// Opens a connection to `url`.
export function connect(url: string): Channel {
  return new Channel(new WebSocket(url));
}
