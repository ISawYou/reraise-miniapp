import { describe, expect, it } from "vitest";
import {
  COMPLETION_ROSTER_CHANGED_MESSAGE,
  reconcileCompletionRosterRows,
} from "@/lib/tournament-completion-roster";

const row = (player_id: string, place: number) => ({ player_id, place });

describe("reconcileCompletionRosterRows -- the canonical roster is the authority", () => {
  it("keeps only canonical (registered/attended) rows; stale waitlist/no-show/cancelled rows are ignored", () => {
    const result = reconcileCompletionRosterRows(
      [row("p1", 1), row("noshow", 0), row("p2", 2), row("waitlist", 0), row("cancelled", 0)],
      ["p1", "p2"]
    );
    expect(result).toEqual({
      ok: true,
      rows: [row("p1", 1), row("p2", 2)],
      ignoredPlayerIds: ["noshow", "waitlist", "cancelled"],
    });
  });

  it("fails closed when a canonical participant is missing -- never silently omitted", () => {
    const result = reconcileCompletionRosterRows([row("p1", 1)], ["p1", "p2", "p3"]);
    expect(result).toEqual({
      ok: false,
      message: COMPLETION_ROSTER_CHANGED_MESSAGE,
      missingPlayerIds: ["p2", "p3"],
    });
    expect(COMPLETION_ROSTER_CHANGED_MESSAGE).toBe(
      "Данные участников изменились. Обновите таблицу и повторите завершение."
    );
  });

  it("a duplicate submitted row for one player can never produce two results (first wins)", () => {
    const result = reconcileCompletionRosterRows([row("p1", 1), row("p1", 7)], ["p1"]);
    expect(result).toMatchObject({ ok: true, rows: [row("p1", 1)] });
  });

  it("empty canonical roster + only stale rows => nothing to complete, nothing invented", () => {
    expect(reconcileCompletionRosterRows([row("stale", 0)], [])).toEqual({
      ok: true,
      rows: [],
      ignoredPlayerIds: ["stale"],
    });
  });
});
