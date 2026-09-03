import { describe, expect, it } from "vitest";
import { getFinalRegistrationLabel } from "@/lib/tournament-final-policy";

// Pure presentation decision shared by Home, /tournaments, and the
// tournament detail page (see the doc comment on
// lib/tournament-final-policy.ts) -- kept as one small pure function
// precisely so it's trivially testable without rendering any of the three
// surfaces.
describe("getFinalRegistrationLabel", () => {
  it("shows the invited label when the player is in the final's composition", () => {
    expect(getFinalRegistrationLabel(true)).toBe("Вы в составе финала");
  });

  it("shows the invite-only label when the player is not in the final's composition", () => {
    expect(getFinalRegistrationLabel(false)).toBe("Только по приглашению");
  });
});
