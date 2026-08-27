import { describe, expect, it } from "vitest";
import { resolveHomeStaffCardKind } from "@/lib/home-staff-card";

describe("resolveHomeStaffCardKind", () => {
  it("a dealer-only (ordinary player) user gets the 'Моя работа' card, not 'Админ-панель'", () => {
    expect(resolveHomeStaffCardKind("player", true)).toBe("dealer");
  });

  it("an ordinary player with no dealer profile gets no card at all", () => {
    expect(resolveHomeStaffCardKind("player", false)).toBe(null);
  });

  it("operator always gets 'Админ-панель', never the dealer card, regardless of dealer status", () => {
    expect(resolveHomeStaffCardKind("operator", false)).toBe("admin");
    expect(resolveHomeStaffCardKind("operator", true)).toBe("admin");
  });

  it("admin (Super Admin) always gets 'Админ-панель', never the dealer card, regardless of dealer status", () => {
    expect(resolveHomeStaffCardKind("admin", false)).toBe("admin");
    expect(resolveHomeStaffCardKind("admin", true)).toBe("admin");
  });

  it("no role at all (null/undefined) is never treated as staff -- falls through to the dealer check", () => {
    expect(resolveHomeStaffCardKind(null, false)).toBe(null);
    expect(resolveHomeStaffCardKind(undefined, true)).toBe("dealer");
  });
});
