import { Centrifuge, State, UnauthorizedError } from "centrifuge";
import pb from "./pb";

// One shared connection for the whole app, created on first use. Callers
// only ever see subscribeToCollection below, so nothing else depends on
// the centrifuge SDK.
let client: Centrifuge | undefined;

function getClient(): Centrifuge {
  if (client) return client;

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const created = new Centrifuge(
    `${protocol}//${location.host}/connection/websocket`,
    {
      // Called on every (re)connect, so a reconnect always presents the
      // current PocketBase token. UnauthorizedError stops the SDK from
      // retrying with a token that can never work.
      getToken: async () => {
        if (!pb.authStore.isValid) {
          throw new UnauthorizedError("no valid session");
        }
        return pb.authStore.token;
      },
    },
  );

  // The connection's lifetime follows the PocketBase session.
  pb.authStore.onChange(() => {
    if (pb.authStore.isValid) created.connect();
    else created.disconnect();
  });

  created.connect();
  client = created;
  return created;
}

// The app's own view of the connection, so callers never see the SDK's State.
export type ConnectionState = "online" | "connecting" | "offline";

function toConnectionState(state: State): ConnectionState {
  if (state === State.Connected) return "online";
  if (state === State.Connecting) return "connecting";
  return "offline";
}

// Reports the current connection state immediately, then on every change.
// Returns a function that stops watching.
export function watchConnectionState(
  onChange: (state: ConnectionState) => void,
): () => void {
  const connection = getClient();
  const handler = (ctx: { newState: State }) =>
    onChange(toConnectionState(ctx.newState));
  connection.on("state", handler);
  // connect() may already have changed the state before the listener existed.
  onChange(toConnectionState(connection.state));
  return () => connection.removeListener("state", handler);
}

// Restarts a connection that stopped for good (terminal disconnect code).
// A no-op while connecting or connected.
export function reconnect(): void {
  getClient().connect();
}

// One realtime change to a record of a replicated collection, as published
// by the server (see internal/realtime). `action` is "create", "update" or
// "delete".
export interface CollectionEvent<T> {
  action: string;
  record: T;
}

// Subscribes to a server channel and returns an unsubscribe function. Every
// message is passed to onData as the server published it.
//
// `onResync` fires when events may have been missed and could not be
// replayed (server restart, history expired, history overflow). The caller
// must then reload what it shows from the server. A plain short disconnect
// does not trigger it: the server replays the missed events through
// `onEvent` instead.
export function subscribeToChannel<T>(
  name: string,
  onData: (data: T) => void,
  onResync: () => void,
): () => void {
  const connection = getClient();
  const subscription = connection.newSubscription(name);
  let subscribedBefore = false;

  subscription.on("publication", (ctx) => onData(ctx.data as T));
  subscription.on("subscribed", (ctx) => {
    // The first subscription has no earlier state to recover. Any later one
    // that did not recover may have a gap.
    if (subscribedBefore && !ctx.recovered) onResync();
    subscribedBefore = true;
  });
  subscription.on("error", (ctx) => {
    console.error(`[realtime] ${name} subscription error:`, ctx.error);
  });
  subscription.subscribe();

  return () => {
    subscription.unsubscribe();
    connection.removeSubscription(subscription);
  };
}

// Subscribes to every event of one replicated collection (see
// internal/replica), across all pods. The channel is named after the
// collection.
export function subscribeToCollection<T>(
  name: string,
  onEvent: (event: CollectionEvent<T>) => void,
  onResync: () => void,
): () => void {
  return subscribeToChannel<CollectionEvent<T>>(name, onEvent, onResync);
}
