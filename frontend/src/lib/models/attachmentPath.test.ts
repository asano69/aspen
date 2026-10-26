import { describe, expect, it } from "vitest";
import { resolveImageSrc } from "./attachmentPath";

describe("resolveImageSrc", () => {
  it("resolves an attachment path against the attachments collection", () => {
    expect(resolveImageSrc("@/files/01G65Z755AFWAKHE12NY0CQ9FH.png")).toBe(
      "/files/01G65Z755AFWAKHE12NY0CQ9FH.png",
    );
  });

  it("leaves any other source untouched", () => {
    expect(resolveImageSrc("https://example.com/a.png")).toBe(
      "https://example.com/a.png",
    );
    expect(resolveImageSrc("/api/files/renders/x/y.svg")).toBe(
      "/api/files/renders/x/y.svg",
    );
  });
});
