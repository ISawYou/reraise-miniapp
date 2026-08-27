import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The completed-tournament exclusion must apply to exactly ONE of the two
// TournamentSelect usages on this page (Start Shift), never the other
// (Super Admin's completed-shift "Редактировать смену" correction). There
// is no render-test harness for this page (many unrelated dependencies),
// so this is a lightweight source-wiring guard: it fails loudly if a future
// edit ever swaps which tournaments array either modal is fed, which a pure
// unit test of the filter function alone (see
// lib/__tests__/dealer-tournament-select.test.ts) cannot catch.
const source = readFileSync(
  join(process.cwd(), "app/admin/dealers/page.tsx"),
  "utf-8"
);

function tournamentSelectBlocks(src: string): string[] {
  return src.split("<TournamentSelect").slice(1).map((chunk) => chunk.split("/>")[0]);
}

describe("app/admin/dealers/page.tsx tournament-select wiring", () => {
  it("has exactly two TournamentSelect usages: Start Shift and completed-shift correction", () => {
    expect(tournamentSelectBlocks(source)).toHaveLength(2);
  });

  it("the Start Shift modal feeds the FILTERED (non-completed) tournament list", () => {
    const [startShiftBlock] = tournamentSelectBlocks(source);
    expect(startShiftBlock).toContain("value={startShiftTournamentId}");
    expect(startShiftBlock).toContain("tournaments={startableTournaments}");
  });

  it("the completed-shift correction modal still feeds the FULL (unfiltered) tournament list -- historical completed tournaments remain referenceable", () => {
    const [, editShiftBlock] = tournamentSelectBlocks(source);
    expect(editShiftBlock).toContain("value={editTournamentId}");
    expect(editShiftBlock).toContain("tournaments={tournaments}");
  });

  it("\"Без турнира\" is always rendered by TournamentSelect itself, independent of which tournaments list is passed in", () => {
    expect(source).toContain('<option value={NO_TOURNAMENT_VALUE}>Без турнира</option>');
  });
});
