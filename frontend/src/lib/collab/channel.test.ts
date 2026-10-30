import { expect, test } from "vitest";
import { Channel } from "./channel";

class FakeSocket extends EventTarget {
  readyState = 1; // WebSocket.OPEN
  sent: string[] = [];
  closed: [number, string][] = [];

  send(data: string) {
    this.sent.push(data);
  }
  close(code: number, reason: string) {
    this.closed.push([code, reason]);
  }
  receive(data: string) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

function setup() {
  const socket = new FakeSocket();
  return { socket, channel: new Channel(socket as unknown as WebSocket) };
}

test("handlers of a type are called in registration order", () => {
  const { socket, channel } = setup();
  const calls: string[] = [];
  channel.on("a", () => calls.push("first"));
  channel.on("a", () => calls.push("second"));
  channel.on("b", () => calls.push("other type"));

  socket.receive('{"type":"a"}');
  expect(calls).toEqual(["first", "second"]);
});

test("a handler stops being called after it was removed", () => {
  const { socket, channel } = setup();
  let n = 0;
  const off = channel.on("a", () => n++);

  socket.receive('{"type":"a"}');
  off();
  socket.receive('{"type":"a"}');
  expect(n).toBe(1);
});

test("a message without a type closes the connection with a reason", () => {
  const { socket } = setup();
  socket.receive("not json");
  expect(socket.closed).toHaveLength(1);
  expect(socket.closed[0][1]).toContain("not a typed JSON object");
});

test("send writes nothing while the connection is not open", () => {
  const { socket, channel } = setup();
  socket.readyState = 0;
  expect(channel.send({ type: "x" })).toBe(false);
  expect(socket.sent).toEqual([]);

  socket.readyState = 1;
  expect(channel.send({ type: "x" })).toBe(true);
  expect(socket.sent).toEqual(['{"type":"x"}']);
});
