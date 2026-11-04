import { describe, expect, it } from "vitest";
import { groupDigits } from "./format";

describe("groupDigits", () => {
  it("groups thousands without touching decimals or small numbers", () => {
    expect(groupDigits("2300.0 ft²")).toBe("2,300.0 ft²");
    expect(groupDigits("18400.0 ft³")).toBe("18,400.0 ft³");
    expect(groupDigits("400.0 ft²")).toBe("400.0 ft²");
    expect(groupDigits("213.75 m²")).toBe("213.75 m²");
  });
});
