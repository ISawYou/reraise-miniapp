import "server-only";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { results, tournaments } from "@/lib/db/schema";
import { assertServerActorRole } from "@/lib/admin-auth";
import { TournamentNotFoundError } from "@/lib/tournament-errors";
import { syncPlayerAchievements } from "@/features/achievements";
import { BOSS_KNOCKOUT_POINTS, KNOCKOUT_POINTS } from "@/features/rating";
import { batchUpdateSpreadsheetValues, readSpreadsheetTabValues } from "@/lib/google-sheets";
import { getFreeSheetColumnLayout, parseFreeSheetValues } from "@/lib/tournament-sheet-parsing";
import { isKnockoutCount, POSTGRES_INTEGER_MAX, type CompletedKnockoutCommand, type CompletedKnockoutSnapshot, type CompletedKnockoutResponse } from "@/lib/completed-knockout-correction";

export class KnockoutCorrectionRejectedError extends Error {}
export class KnockoutCorrectionInvalidError extends Error {}
export class KnockoutCorrectionUnavailableError extends Error {}

type ResultRow = typeof results.$inferSelect;
const tournamentColumns = {
  id: tournaments.id, status: tournaments.status, kind: tournaments.kind,
  tournamentType: tournaments.tournamentType, googleSheetTabName: tournaments.googleSheetTabName,
  isFinal: tournaments.isFinal, ratingFormulaVersion: tournaments.ratingFormulaVersion,
};
type TournamentInfo = { [K in keyof typeof tournamentColumns]: (typeof tournaments.$inferSelect)[K] };
const reject = (message: string): never => { throw new KnockoutCorrectionRejectedError(message); };
export const LEGACY_KO_MESSAGE = "Нельзя достоверно исправить KO этого старого результата: рейтинговые компоненты не подтверждены. Данные не изменены.";

function assertTournament(t: TournamentInfo) {
  if (t.status !== "completed") reject("Исправлять KO можно только в завершённом турнире");
  if (t.tournamentType !== "bounty" && t.tournamentType !== "boss_bounty") reject("Исправление KO доступно только для Bounty и Boss Bounty");
  if (t.ratingFormulaVersion !== "legacy" && t.ratingFormulaVersion !== "v2") reject(LEGACY_KO_MESSAGE);
}

// No full rating calculator. Prove the OLD KO contribution before applying a
// delta, preserving every unrelated frozen value (including nullable ITM).
export function planKnockoutCorrection(t: TournamentInfo, row: ResultRow, knockouts: number, bossKnockouts: number) {
  assertTournament(t);
  if (!isKnockoutCount(knockouts) || !isKnockoutCount(bossKnockouts)) throw new KnockoutCorrectionInvalidError("KO должны быть целыми неотрицательными числами");
  if (t.tournamentType !== "boss_bounty" && (bossKnockouts !== row.bossKnockouts || bossKnockouts !== 0)) reject("Boss KO можно изменять только в Boss Bounty");
  if (!t.isFinal && row.arrived == null) reject(LEGACY_KO_MESSAGE);
  const eligible = !t.isFinal && row.arrived === true;
  const koRate = eligible ? KNOCKOUT_POINTS : 0;
  const bossRate = eligible && t.tournamentType === "boss_bounty" ? BOSS_KNOCKOUT_POINTS : 0;
  const oldKo = row.knockouts * koRate;
  const oldBoss = row.bossKnockouts * bossRate;
  if (!isKnockoutCount(row.knockouts) || !isKnockoutCount(row.bossKnockouts)) reject(LEGACY_KO_MESSAGE);
  if ((row.knockoutPoints != null && row.knockoutPoints !== oldKo) || (row.bossBountyPoints != null && row.bossBountyPoints !== oldBoss)) reject(LEGACY_KO_MESSAGE);
  const other = [row.participationPoints, row.itmPoints, row.mysteryBountyPoints];
  const knownSum = other.reduce<number>((sum, n) => sum + (n ?? 0), oldKo + oldBoss);
  if (other.some(n => n != null && (!Number.isInteger(n) || n < 0)) || row.ratingPoints < knownSum) reject(LEGACY_KO_MESSAGE);
  const missingKo = row.knockoutPoints == null || row.bossBountyPoints == null;
  // A missing KO component is recoverable ONLY when all unrelated components
  // are known and the residual exactly proves the original KO contribution.
  if ((missingKo || other.every(n => n != null)) && (other.some(n => n == null) || row.ratingPoints !== knownSum)) reject(LEGACY_KO_MESSAGE);
  const knockoutPoints = knockouts * koRate;
  const bossBountyPoints = bossKnockouts * bossRate;
  const ratingPoints = row.ratingPoints + knockoutPoints - oldKo + bossBountyPoints - oldBoss;
  if (![knockoutPoints, bossBountyPoints, ratingPoints].every(n => Number.isSafeInteger(n) && n >= 0 && n <= POSTGRES_INTEGER_MAX)) throw new KnockoutCorrectionInvalidError("Значения KO выходят за допустимый диапазон рейтинга");
  return { knockouts, bossKnockouts, knockoutPoints, bossBountyPoints, ratingPoints, koRate, bossRate };
}

function revision(t: TournamentInfo, row: ResultRow) {
  return createHash("sha256").update(JSON.stringify({ tournament: t, result: row })).digest("hex");
}
function snapshot(t: TournamentInfo, row: ResultRow): CompletedKnockoutSnapshot {
  const plan = planKnockoutCorrection(t, row, row.knockouts, row.bossKnockouts);
  return { player_id: row.playerId, knockouts: row.knockouts, boss_knockouts: row.bossKnockouts, rating_points: row.ratingPoints, place: row.place, revision: revision(t, row), points_per_ko: plan.koRate, points_per_boss_ko: plan.bossRate, has_boss_ko: t.tournamentType === "boss_bounty" };
}

async function lockedResult<T>(tournamentId: string, playerId: string, action: (t: TournamentInfo, row: ResultRow, tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) {
  await assertServerActorRole(["admin"]);
  if (process.env.DATABASE_PROVIDER !== "postgres") throw new KnockoutCorrectionUnavailableError("Исправление KO требует PostgreSQL");
  return db.transaction(async tx => {
    const [t] = await tx.select(tournamentColumns).from(tournaments).where(eq(tournaments.id, tournamentId)).for("update");
    if (!t) throw new TournamentNotFoundError(tournamentId);
    assertTournament(t);
    const [row] = await tx.select().from(results).where(and(eq(results.tournamentId, tournamentId), eq(results.playerId, playerId))).for("update");
    if (!row) reject("У игрока нет сохранённого результата в этом турнире");
    return action(t, row, tx);
  });
}

export async function getCompletedKnockoutSnapshot(tournamentId: string, playerId: string) {
  return lockedResult(tournamentId, playerId, async (t, row) => snapshot(t, row));
}

export async function correctCompletedTournamentKnockouts(tournamentId: string, command: CompletedKnockoutCommand): Promise<CompletedKnockoutResponse> {
  const committed = await lockedResult(tournamentId, command.player_id, async (t, row, tx) => {
    if (command.revision !== revision(t, row)) reject("Результат устарел — закройте форму и откройте её снова");
    const plan = planKnockoutCorrection(t, row, command.knockouts, command.boss_knockouts);
    if (plan.knockouts === row.knockouts && plan.bossKnockouts === row.bossKnockouts) return { result: snapshot(t, row), changed: false, tournament: t };
    const [updated] = await tx.update(results).set({ knockouts: plan.knockouts, bossKnockouts: plan.bossKnockouts, knockoutPoints: plan.knockoutPoints, bossBountyPoints: plan.bossBountyPoints, ratingPoints: plan.ratingPoints }).where(eq(results.id, row.id)).returning();
    if (!updated) throw new Error("Correction UPDATE returned no result");
    return { result: snapshot(t, updated), changed: true, tournament: t };
  });
  // db.transaction resolves only AFTER COMMIT. These failures are warnings,
  // never a false claim that a committed correction was rolled back.
  const warnings: string[] = [];
  if (committed.changed) {
    try { await syncPlayerAchievements(command.player_id); }
    catch { warnings.push("KO сохранены, но достижения не синхронизированы — требуется повторная синхронизация."); }
    const warning = await syncSheet(committed.tournament, command.player_id);
    if (warning) warnings.push(warning);
  }
  return { result: committed.result, warnings };
}

function column(index: number) {
  let n = index + 1, value = "";
  while (n > 0) { n--; value = String.fromCharCode(65 + n % 26) + value; n = Math.floor(n / 26); }
  return value;
}
// Bound network waits while holding the post-commit tournament lock.
const SHEET_REQUEST_OPTIONS = { timeout: 10_000, retry: false };
const SHEET_WARNING = "KO сохранены в PostgreSQL, но Google-таблица не синхронизирована — требуется синхронизация вручную.";
async function syncSheet(t: TournamentInfo, playerId: string): Promise<string | undefined> {
  if (!t.googleSheetTabName?.trim()) return;
  if (t.kind !== "free") return SHEET_WARNING;
  try {
    // A second, post-COMMIT transaction serializes the external push with
    // subsequent corrections. Read the LATEST row under the same tournament
    // lock, so slower post-commit tasks cannot overwrite Sheets with old KO.
    await lockedResult(t.id, playerId, async (current, row) => {
      const tab = current.googleSheetTabName?.trim();
      if (!tab || current.kind !== "free") throw new Error("Sheet configuration changed");
      const type = current.tournamentType as "bounty" | "boss_bounty";
      const parsed = parseFreeSheetValues(await readSpreadsheetTabValues(tab, SHEET_REQUEST_OPTIONS), type);
      if (!parsed.ok || parsed.rowNumbersByPlayerId.get(playerId)?.length !== 1) throw new Error("Sheet player mapping is missing or ambiguous");
      const sheetRow = parsed.rows.get(playerId)!;
      const layout = getFreeSheetColumnLayout(type);
      const cells = [[layout.knockoutsIndex, row.knockouts], [layout.ratingIndex, row.ratingPoints]];
      if (layout.bossKnockoutsIndex != null) cells.push([layout.bossKnockoutsIndex, row.bossKnockouts]);
      await batchUpdateSpreadsheetValues(cells.map(([index, value]) => ({ range: `'${tab.replace(/'/g, "''")}'!${column(index)}${sheetRow.rowNumber}`, values: [[value]] })), SHEET_REQUEST_OPTIONS);
    });
  } catch { return SHEET_WARNING; }
}
