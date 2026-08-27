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
