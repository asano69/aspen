import "fake-indexeddb/auto";
import { createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, type CachedCard } from "./db";
import { createLiveQuery } from "./liveQuery";

function card(id: string, pod: string): CachedCard {
  return {
    id,
    pod,
    title: id as CachedCard["title"],
    titleLc: id,
    description: [],
    image: "",
    deleted: "",
    created: "",
    updated: "",
  };
}

interface Row {
  id: string;
  title: string;
}

// Reads the rows of a pod. Counts its runs through `ran`.
function rowsQuery(ran = vi.fn()) {
  return async (pod: string): Promise<Row[]> => {
    ran(pod);
    const cards = await db.cards.where("pod").equals(pod).sortBy("id");
    return cards.map((c) => ({ id: c.id, title: c.title }));
  };
}

// Runs `setup` in a reactive root, like a component would.
function mount<T>(setup: () => T) {
  let dispose!: () => void;
  const result = createRoot((d) => {
    dispose = d;
    return setup();
  });
  return { result, dispose };
}

const ids = (rows: Row[]) => rows.map((r) => r.id);

beforeEach(async () => {
  await db.cards.clear();
});

describe("createLiveQuery", () => {
  it("follows changes of the table", async () => {
    await db.cards.put(card("a", "p"));
    const { result: rows, dispose } = mount(() =>
      createLiveQuery(() => "p", rowsQuery(), [] as Row[]),
    );
    await vi.waitFor(() => expect(ids(rows())).toEqual(["a"]));

    await db.cards.put(card("b", "p"));
    await vi.waitFor(() => expect(ids(rows())).toEqual(["a", "b"]));

    await db.cards.delete("a");
    await vi.waitFor(() => expect(ids(rows())).toEqual(["b"]));
    dispose();
  });

  it("subscribes again when the arguments change", async () => {
    await db.cards.bulkPut([card("a", "p1"), card("b", "p2")]);
    const [pod, setPod] = createSignal("p1");
    const { result: rows, dispose } = mount(() =>
      createLiveQuery(pod, rowsQuery(), [] as Row[]),
    );
    await vi.waitFor(() => expect(ids(rows())).toEqual(["a"]));

    setPod("p2");
    await vi.waitFor(() => expect(ids(rows())).toEqual(["b"]));
    dispose();
  });

  it("goes back to the initial value without arguments, and does not query", async () => {
    await db.cards.put(card("a", "p"));
    const ran = vi.fn();
    const [pod, setPod] = createSignal<string | undefined>(undefined);
    const { result: rows, dispose } = mount(() =>
      createLiveQuery(pod, rowsQuery(ran), [] as Row[]),
    );
    await Promise.resolve();
    expect(ran).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);

    setPod("p");
    await vi.waitFor(() => expect(ids(rows())).toEqual(["a"]));

    setPod(undefined);
    await vi.waitFor(() => expect(rows()).toEqual([]));
    dispose();
  });

  it("keeps the identity of a record that did not change", async () => {
    await db.cards.put(card("a", "p"));
    const { result: rows, dispose } = mount(() =>
      createLiveQuery(() => "p", rowsQuery(), [] as Row[]),
    );
    await vi.waitFor(() => expect(ids(rows())).toEqual(["a"]));
    const first = rows()[0];

    await db.cards.put(card("b", "p"));
    await vi.waitFor(() => expect(ids(rows())).toEqual(["a", "b"]));
    expect(rows()[0]).toBe(first);
    dispose();
  });

  it("stops querying once disposed", async () => {
    await db.cards.put(card("a", "p"));
    const ran = vi.fn();
    const { result: rows, dispose } = mount(() =>
      createLiveQuery(() => "p", rowsQuery(ran), [] as Row[]),
    );
    await vi.waitFor(() => expect(ids(rows())).toEqual(["a"]));

    dispose();
    const runs = ran.mock.calls.length;
    await db.cards.put(card("b", "p"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(ran).toHaveBeenCalledTimes(runs);
    expect(ids(rows())).toEqual(["a"]);
  });

  it("logs a failing query and keeps the last value", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await db.cards.put(card("a", "p"));
    let fail = false;
    const query = async (pod: string) => {
      if (fail) throw new Error("boom");
      return rowsQuery()(pod);
    };
    const { result: rows, dispose } = mount(() =>
      createLiveQuery(() => "p", query, [] as Row[]),
    );
    await vi.waitFor(() => expect(ids(rows())).toEqual(["a"]));

    fail = true;
    await db.cards.put(card("b", "p"));
    await vi.waitFor(() => expect(logged).toHaveBeenCalled());
    expect(ids(rows())).toEqual(["a"]);

    logged.mockRestore();
    dispose();
  });
});
