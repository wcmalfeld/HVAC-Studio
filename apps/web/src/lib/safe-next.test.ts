import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps same-origin paths with query and hash", () => {
    expect(safeNext("/projects/abc/studio?x=1#y")).toBe("/projects/abc/studio?x=1#y");
    expect(safeNext("/dashboard")).toBe("/dashboard");
  });
  it.each([null, "", "dashboard", "//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "\\\\evil.com", "https://evil.com", "javascript:alert(1)", "/\\/evil.com"])(
    "rejects %j",
    (n) => expect(safeNext(n)).toBe("/dashboard"),
  );
});
