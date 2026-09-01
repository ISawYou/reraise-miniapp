import { describe, expect, it, vi } from "vitest";

// app/admin/page.tsx transitively imports features/auth.ts (via
// lib/current-player.ts), which imports the Postgres-backed player
// repository -- mocked here purely so importing the module for its
// OPERATOR_SECTIONS export doesn't require real DB env vars, same as
// middleware.test.ts does for the same reason.
vi.mock("@/lib/repositories", () => ({
  playerRepository: {},
}));

const { OPERATOR_SECTIONS } = await import("@/app/admin/page");

describe("Admin landing navigation -- operator sections", () => {
  it("exposes the nickname moderation entry to operator", () => {
    const hrefs = OPERATOR_SECTIONS.flatMap((section) => section.items.map((item) => item.href));
    expect(hrefs).toContain("/admin/moderation");
  });

  it("does not expose the rest of the Super-Admin-only PLAYERS section (Активность, Реферальная программа, Зачёт рейтинга)", () => {
    const hrefs = OPERATOR_SECTIONS.flatMap((section) => section.items.map((item) => item.href));
    expect(hrefs).not.toContain("/admin/activity");
    expect(hrefs).not.toContain("/admin/referral");
    expect(hrefs).not.toContain("/admin/rating-eligibility");
  });

  it("does not expose Super-Admin-only staff/system items (dealer stats, roles, settings)", () => {
    const hrefs = OPERATOR_SECTIONS.flatMap((section) => section.items.map((item) => item.href));
    expect(hrefs).not.toContain("/admin/dealers/stats");
    expect(hrefs).not.toContain("/admin/roles");
    expect(hrefs).not.toContain("/admin/settings");
  });
});
