import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeAlive } from "../dexie/linkAliveQuery";
import {
  linkAlive,
  markLinkAlivePodReady,
  refreshLinkAlive,
  releaseLinkAlive,
  requestLinkAlive,
} from "./linkAliveStore";

vi.mock("../dexie/linkAliveQuery", () => ({
  computeAlive: vi.fn(async () => true),
}));

beforeEach(() => {
  releaseLinkAlive("p");
  vi.mocked(computeAlive).mockReset();
  vi.mocked(computeAlive).mockResolvedValue(true);
});

describe("linkAliveStore", () => {
  it("answers nothing until the pod is ready", async () => {
    requestLinkAlive("p", "a");
    expect(computeAlive).not.toHaveBeenCalled();
    expect(linkAlive("p", "a")).toBeUndefined();

    markLinkAlivePodReady("p");
    await vi.waitFor(() => expect(linkAlive("p", "a")).toBe(true));
  });

  it("stores a dead result", async () => {
    vi.mocked(computeAlive).mockResolvedValue(false);
    markLinkAlivePodReady("p");
    requestLinkAlive("p", "ghost");
    await vi.waitFor(() => expect(linkAlive("p", "ghost")).toBe(false));
  });

  it("evaluates a key once however often it is requested", async () => {
    markLinkAlivePodReady("p");
    requestLinkAlive("p", "a");
    requestLinkAlive("p", "a");
    await vi.waitFor(() => expect(linkAlive("p", "a")).toBe(true));
    expect(computeAlive).toHaveBeenCalledTimes(1);
  });

  it("re-evaluates requested keys on refresh", async () => {
    markLinkAlivePodReady("p");
    requestLinkAlive("p", "a");
    await vi.waitFor(() => expect(linkAlive("p", "a")).toBe(true));

    vi.mocked(computeAlive).mockResolvedValue(false);
    refreshLinkAlive();
    await vi.waitFor(() => expect(linkAlive("p", "a")).toBe(false));
  });

  it("drops results on release and ignores a late answer", async () => {
    let resolve!: (value: boolean) => void;
    vi.mocked(computeAlive).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    markLinkAlivePodReady("p");
    requestLinkAlive("p", "a");
    releaseLinkAlive("p");
    resolve(false);
    await Promise.resolve();

    expect(linkAlive("p", "a")).toBeUndefined();
  });
});
