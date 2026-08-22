import { describe, expect, it } from "vitest";
import { normalizeInternalReturnTo } from "@/lib/auth-redirect";

describe("normalizeInternalReturnTo", () => {
  it("keeps an internal Academy path with query parameters", () => {
    expect(
      normalizeInternalReturnTo("/academy/preflop/utg/train?from=lesson"),
    ).toBe("/academy/preflop/utg/train?from=lesson");
  });

  it.each([
    "https://attacker.example/academy",
    "//attacker.example/academy",
    "/login",
    null,
  ])("rejects an unsafe or recursive return target: %s", (target) => {
    expect(normalizeInternalReturnTo(target)).toBe("/");
  });
});
