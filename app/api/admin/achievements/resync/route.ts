import { NextResponse } from "next/server";
import { playerRepository, resultRepository } from "@/lib/repositories";
import {
  getPlayerAchievementProgress,
  syncPlayerAchievements,
} from "@/features/achievements";
import { ACHIEVEMENT_CATEGORY, ACHIEVEMENTS_CATALOG } from "@/config/achievements";

// Standing admin operation: "recalculate automatic achievements for every
// player" — not a one-off ITM script. Reusable as-is for any future
// evaluator (Attendance, Final Tables, ...) with zero changes here, since
// it only ever calls the existing Achievement flow
// (getPlayerAchievementProgress / syncPlayerAchievements), never
// duplicates evaluator logic. Gated by middleware.ts's blanket
// `/api/admin/:path*` admin-role check — no separate auth code needed here.
//
// Default mode is a read-only dry-run (`apply` must be explicitly `true`)
// so a stray request can never trigger a write.

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;

const ITM_CODES = new Set<string>(
  ACHIEVEMENTS_CATALOG.filter((definition) => definition.category === ACHIEVEMENT_CATEGORY.ITM).map(
    (definition) => definition.code
  )
);

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function resolveBatchSize(requested: unknown): number {
  const parsed = typeof requested === "number" && Number.isFinite(requested) ? requested : DEFAULT_BATCH_SIZE;
  return Math.min(Math.max(Math.floor(parsed), 1), MAX_BATCH_SIZE);
}

async function runDryRun(playerIds: string[], batchSize: number) {
  let playersWithResults = 0;
  const itmThresholds = { gte1: 0, gte10: 0, gte25: 0, gte100: 0 };
  const projectedCompletedItmAchievements: Record<string, number> = {};
  for (const code of ITM_CODES) {
    projectedCompletedItmAchievements[code] = 0;
  }

  const batches = chunk(playerIds, batchSize);

  for (const [index, batch] of batches.entries()) {
    const results = await Promise.all(
      batch.map(async (playerId) => {
        const [resultCount, itmFinishes, progress] = await Promise.all([
          resultRepository.countByPlayerId(playerId),
          resultRepository.countItmFinishesByPlayerId(playerId),
          getPlayerAchievementProgress(playerId),
        ]);
        return { resultCount, itmFinishes, progress };
      })
    );

    for (const { resultCount, itmFinishes, progress } of results) {
      if (resultCount > 0) playersWithResults += 1;
      if (itmFinishes >= 1) itmThresholds.gte1 += 1;
      if (itmFinishes >= 10) itmThresholds.gte10 += 1;
      if (itmFinishes >= 25) itmThresholds.gte25 += 1;
      if (itmFinishes >= 100) itmThresholds.gte100 += 1;

      for (const entry of progress) {
        if (entry.completed && ITM_CODES.has(entry.code)) {
          projectedCompletedItmAchievements[entry.code] += 1;
        }
      }
    }

    console.log(
      `[achievements-resync][dry-run] batch ${index + 1}/${batches.length} (${results.length} players) checked`
    );
  }

  return {
    playersWithResults,
    itmThresholds,
    projectedCompletedItmAchievements,
  };
}

async function runApply(playerIds: string[], batchSize: number) {
  let processed = 0;
  let succeeded = 0;
  const errors: Array<{ player_id: string; error: string }> = [];

  const batches = chunk(playerIds, batchSize);

  for (const [index, batch] of batches.entries()) {
    // Per-player upsert (syncPlayerAchievements), not one giant
    // transaction across every player — a failed/interrupted run is safe
    // to simply re-run: already-synced players are recomputed to the same
    // values (idempotent), and completed_at is preserved, not reset (see
    // features/achievements.ts).
    const outcomes = await Promise.allSettled(
      batch.map((playerId) => syncPlayerAchievements(playerId))
    );

    outcomes.forEach((outcome, i) => {
      processed += 1;
      if (outcome.status === "fulfilled") {
        succeeded += 1;
      } else {
        errors.push({
          player_id: batch[i],
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        });
      }
    });

    console.log(
      `[achievements-resync][apply] batch ${index + 1}/${batches.length} done — ${processed}/${playerIds.length} processed, ${errors.length} error(s) so far`
    );
  }

  return { processed, succeeded, errors };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    apply?: boolean;
    batchSize?: number;
  };

  const apply = body.apply === true;
  const batchSize = resolveBatchSize(body.batchSize);

  const players = await playerRepository.listOrderedByCreatedAtDesc();
  const playerIds = players.map((player) => player.id);

  if (!apply) {
    const preview = await runDryRun(playerIds, batchSize);
    return NextResponse.json({
      ok: true,
      mode: "dry-run",
      batchSize,
      totalPlayers: playerIds.length,
      ...preview,
    });
  }

  const result = await runApply(playerIds, batchSize);
  return NextResponse.json({
    ok: result.errors.length === 0,
    mode: "apply",
    batchSize,
    totalPlayers: playerIds.length,
    processed: result.processed,
    succeeded: result.succeeded,
    failed: result.errors.length,
    errors: result.errors,
  });
}
