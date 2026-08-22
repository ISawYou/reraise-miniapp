import {
  previewPlayerAchievementSync,
  syncPlayerAchievements,
} from "@/features/achievements";
import { ACHIEVEMENTS_CATALOG } from "@/config/achievements";
import {
  achievementRepository,
  clubActivityRepository,
  playerRepository,
} from "@/lib/repositories";
import type { PlayerAchievement } from "@/types/domain";

const PROTECTED_CODES = new Set(["royal_flush", "number_one"]);
const CATALOG_CODES = new Set<string>(
  ACHIEVEMENTS_CATALOG.map(({ code }) => code),
);

type PhaseReport = {
  mode: "dry-run" | "apply";
  totalPlayers: number;
  processed: number;
  newCompletions: number;
  progressChanges: number;
  errors: Array<{ playerId: string; error: string }>;
  staleUnknownCodes: string[];
  completionBreakdown: Record<string, number>;
  newCompletionBreakdown: Record<string, number>;
  completedRemovals: number;
  completedAtChanges: number;
  protectedChanges: number;
  staleChanges: number;
};

function sameRow(left: PlayerAchievement, right: PlayerAchievement): boolean {
  return left.current_value === right.current_value
    && left.completed_at === right.completed_at
    && left.updated_at === right.updated_at;
}

function activitySnapshot(rows: Awaited<ReturnType<typeof clubActivityRepository.listAdmin>>) {
  return rows.map(({ id, event_type, achievement_code, idempotency_key, updated_at }) => ({
    id,
    event_type,
    achievement_code,
    idempotency_key,
    updated_at,
  }));
}

function emptyReport(mode: PhaseReport["mode"], totalPlayers: number): PhaseReport {
  return {
    mode,
    totalPlayers,
    processed: 0,
    newCompletions: 0,
    progressChanges: 0,
    errors: [],
    staleUnknownCodes: [],
    completionBreakdown: {},
    newCompletionBreakdown: {},
    completedRemovals: 0,
    completedAtChanges: 0,
    protectedChanges: 0,
    staleChanges: 0,
  };
}

function increment(target: Record<string, number>, code: string): void {
  target[code] = (target[code] ?? 0) + 1;
}

async function runPhase(
  playerIds: string[],
  mode: PhaseReport["mode"],
): Promise<PhaseReport> {
  const report = emptyReport(mode, playerIds.length);
  const staleCodes = new Set<string>();

  for (const playerId of playerIds) {
    try {
      const before = await achievementRepository.findByPlayerId(playerId);
      const plan = mode === "apply"
        ? await syncPlayerAchievements(playerId, { publishActivityEvents: false })
        : await previewPlayerAchievementSync(playerId);

      report.processed += 1;
      report.progressChanges += plan.progressChanges;
      report.newCompletions += plan.newlyCompletedCodes.length;
      plan.staleCodes.forEach((code) => staleCodes.add(code));
      plan.projectedCompletedCodes.forEach((code) => increment(report.completionBreakdown, code));
      plan.newlyCompletedCodes.forEach((code) => increment(report.newCompletionBreakdown, code));

      const changedCodes = new Set(plan.changedPayload.map((row) => row.achievement_code));
      const projectedCompleted = new Set(plan.projectedCompletedCodes);
      for (const row of before) {
        if (row.completed_at && !projectedCompleted.has(row.achievement_code)) {
          report.completedRemovals += 1;
        }
        const projected = plan.payload.find(
          (item) => item.achievement_code === row.achievement_code,
        );
        if (row.completed_at && projected && projected.completed_at !== row.completed_at) {
          report.completedAtChanges += 1;
        }
        if (PROTECTED_CODES.has(row.achievement_code) && changedCodes.has(row.achievement_code)) {
          report.protectedChanges += 1;
        }
        if (!CATALOG_CODES.has(row.achievement_code) && changedCodes.has(row.achievement_code)) {
          report.staleChanges += 1;
        }
      }

      if (mode === "apply") {
        const after = await achievementRepository.findByPlayerId(playerId);
        const afterByCode = new Map(after.map((row) => [row.achievement_code, row]));
        for (const previous of before) {
          const current = afterByCode.get(previous.achievement_code);
          if (previous.completed_at && !current) report.completedRemovals += 1;
          if (previous.completed_at && current?.completed_at !== previous.completed_at) {
            report.completedAtChanges += 1;
          }
          if (
            current
            && (PROTECTED_CODES.has(previous.achievement_code)
              || !CATALOG_CODES.has(previous.achievement_code))
            && !sameRow(previous, current)
          ) {
            if (PROTECTED_CODES.has(previous.achievement_code)) report.protectedChanges += 1;
            else report.staleChanges += 1;
          }
        }
        for (const code of plan.newlyCompletedCodes) {
          if (!afterByCode.get(code)?.completed_at) {
            throw new Error(`New completion ${code} was not persisted`);
          }
        }
      }
    } catch (error) {
      report.errors.push({
        playerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  report.staleUnknownCodes = [...staleCodes].sort();
  return report;
}

function assertSafe(report: PhaseReport, label: string): void {
  const violations = [
    report.errors.length > 0 && `${report.errors.length} player errors`,
    report.completedRemovals > 0 && `${report.completedRemovals} completed removals`,
    report.completedAtChanges > 0 && `${report.completedAtChanges} completed_at changes`,
    report.protectedChanges > 0 && `${report.protectedChanges} Royal Flush/Number One changes`,
    report.staleChanges > 0 && `${report.staleChanges} stale-code changes`,
  ].filter(Boolean);
  if (violations.length > 0) throw new Error(`${label} safety gate failed: ${violations.join(", ")}`);
}

function printReport(label: string, report: PhaseReport): void {
  console.log(`${label}=${JSON.stringify(report)}`);
}

async function main(): Promise<void> {
  const operation = process.env.ACHIEVEMENT_RESYNC_OPERATION ?? "dry-run";
  if (operation !== "dry-run" && operation !== "release") {
    throw new Error("ACHIEVEMENT_RESYNC_OPERATION must be dry-run or release");
  }

  const players = await playerRepository.listOrderedByCreatedAtDesc();
  const playerIds = players.map(({ id }) => id);
  const feedBefore = activitySnapshot(await clubActivityRepository.listAdmin(200));

  const initialDryRun = await runPhase(playerIds, "dry-run");
  printReport("INITIAL_DRY_RUN", initialDryRun);
  assertSafe(initialDryRun, "Initial dry run");

  const feedAfterDryRun = activitySnapshot(await clubActivityRepository.listAdmin(200));
  if (JSON.stringify(feedAfterDryRun) !== JSON.stringify(feedBefore)) {
    throw new Error("Activity Feed changed during dry run");
  }
  if (operation === "dry-run") return;

  const apply = await runPhase(playerIds, "apply");
  printReport("RESYNC_APPLY", apply);
  assertSafe(apply, "Apply");

  const feedAfterApply = activitySnapshot(await clubActivityRepository.listAdmin(200));
  if (JSON.stringify(feedAfterApply) !== JSON.stringify(feedBefore)) {
    throw new Error("Activity Feed changed during bulk resync");
  }

  const finalDryRun = await runPhase(playerIds, "dry-run");
  printReport("POST_APPLY_DRY_RUN", finalDryRun);
  assertSafe(finalDryRun, "Post-apply dry run");
  if (finalDryRun.newCompletions !== 0 || finalDryRun.progressChanges !== 0) {
    throw new Error(
      `Post-apply dry run is not idempotent: newCompletions=${finalDryRun.newCompletions}, progressChanges=${finalDryRun.progressChanges}`,
    );
  }

  console.log(`ACTIVITY_FEED_SPAM=NONE snapshotSize=${feedBefore.length}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
