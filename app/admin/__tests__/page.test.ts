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

  // RELEASE A: referral simplification -- an ordinary operator may now edit
  // referral_count (narrow count-only endpoint, allowlisted in
  // lib/admin-permissions.ts; the page itself only exposes the referral
  // counter, see app/admin/referral/page.tsx). Activity and Зачёт рейтинга
  // stay Super-Admin-only.
  it("exposes the referral program entry to operator, but not the rest of the Super-Admin-only PLAYERS section (Активность, Зачёт рейтинга)", () => {
    const hrefs = OPERATOR_SECTIONS.flatMap((section) => section.items.map((item) => item.href));
    expect(hrefs).toContain("/admin/referral");
    expect(hrefs).not.toContain("/admin/activity");
    expect(hrefs).not.toContain("/admin/rating-eligibility");
  });

  // RELEASE A: Royal Flush manual achievement moderation for operator --
  // reaches the achievements page (which itself hides Visuals/Resync for a
  // non-Super-Admin caller, see app/admin/achievements/page.tsx).
  it("exposes the achievements entry to operator (manual Royal Flush moderation only, enforced inside the page and by the server-side assertManualAchievement guard)", () => {
    const hrefs = OPERATOR_SECTIONS.flatMap((section) => section.items.map((item) => item.href));
    expect(hrefs).toContain("/admin/achievements");
  });

  it("does not expose Super-Admin-only staff/system items (dealer stats, roles, settings, admin-shift management)", () => {
    const hrefs = OPERATOR_SECTIONS.flatMap((section) => section.items.map((item) => item.href));
    expect(hrefs).not.toContain("/admin/dealers/stats");
    expect(hrefs).not.toContain("/admin/roles");
    expect(hrefs).not.toContain("/admin/settings");
    expect(hrefs).not.toContain("/admin/admin-shifts");
    expect(hrefs).not.toContain("/admin/news");
    expect(hrefs).not.toContain("/admin/tournament-visuals");
    expect(hrefs).not.toContain("/admin/academy");
    expect(hrefs).not.toContain("/admin/account-merges");
  });
});
