import { describe, expect, it } from "vitest";
import { isAdminRouteAllowedForOperator } from "@/lib/admin-permissions";

// The elimination-correction feature (return-to-game, reorder-eliminations)
// must be usable by the same operational Admin/operator who is already
// allowed to mark eliminations -- not a new, broader capability, and not
// restricted to Super Admin only. See features/tournament-sheet-sync.ts's
// setTournamentPlayerEliminationThroughSheet / reorderTournamentEliminationsThroughSheet.
describe("isAdminRouteAllowedForOperator -- elimination correction routes", () => {
  it("allows an operator to return a player to the game (same tier as /eliminate)", () => {
    expect(
      isAdminRouteAllowedForOperator("POST", "/api/admin/tournaments/t1/return-to-game")
    ).toBe(true);
  });

  it("allows an operator to save a corrected elimination order", () => {
    expect(
      isAdminRouteAllowedForOperator("POST", "/api/admin/tournaments/t1/reorder-eliminations")
    ).toBe(true);
  });

  it("still denies an unrelated Super-Admin-only route -- this change did not widen operator access generally", () => {
    expect(isAdminRouteAllowedForOperator("DELETE", "/api/admin/tournaments/t1")).toBe(false);
    expect(isAdminRouteAllowedForOperator("POST", "/api/admin/dealers/rates")).toBe(false);
  });

  it("only accepts POST for the new routes -- GET/DELETE are not on the allowlist", () => {
    expect(
      isAdminRouteAllowedForOperator("GET", "/api/admin/tournaments/t1/return-to-game")
    ).toBe(false);
    expect(
      isAdminRouteAllowedForOperator("DELETE", "/api/admin/tournaments/t1/reorder-eliminations")
    ).toBe(false);
  });
});

// Operator gets exactly two new operational actions: toggle the existing
// fixed "Чай" allowance on a dealer shift, and approve a pending nickname
// submission as-is. Neither widens operator access to the surrounding
// Super-Admin-only capabilities (shift corrections / reject / edit /
// block / delete).
describe("isAdminRouteAllowedForOperator -- dealer 'Чай' + nickname approval", () => {
  it("allows an operator to toggle the dealer shift taxi allowance", () => {
    expect(
      isAdminRouteAllowedForOperator(
        "PATCH",
        "/api/admin/dealers/shifts/s1/taxi-allowance"
      )
    ).toBe(true);
  });

  it("still denies the broad Super-Admin-only shift-correction route -- rate/timestamps/reassignment stay locked", () => {
    expect(isAdminRouteAllowedForOperator("PATCH", "/api/admin/dealers/shifts/s1")).toBe(
      false
    );
  });

  it("allows an operator to read the pending-nicknames queue", () => {
    expect(isAdminRouteAllowedForOperator("GET", "/api/admin/nicknames/pending")).toBe(true);
  });

  it("allows an operator to approve a pending nickname", () => {
    expect(
      isAdminRouteAllowedForOperator("PATCH", "/api/admin/nicknames/p1/approve")
    ).toBe(true);
  });

  it("still denies the generic nickname PATCH (reject / set_admin_display_name) and player block/delete", () => {
    expect(isAdminRouteAllowedForOperator("PATCH", "/api/admin/nicknames/p1")).toBe(false);
    expect(isAdminRouteAllowedForOperator("PATCH", "/api/admin/players/p1")).toBe(false);
    expect(isAdminRouteAllowedForOperator("DELETE", "/api/admin/players/p1")).toBe(false);
  });
});
