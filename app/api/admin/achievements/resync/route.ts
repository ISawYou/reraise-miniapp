import { NextResponse } from "next/server";
import { playerRepository } from "@/lib/repositories";
import {
  previewPlayerAchievementSync,
  syncPlayerAchievements,
} from "@/features/achievements";

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function resolveBatchSize(value: unknown): number {
  const parsed = typeof value === "number" && Number.isFinite(value)
    ? value
    : DEFAULT_BATCH_SIZE;
  return Math.min(Math.max(Math.floor(parsed), 1), MAX_BATCH_SIZE);
}

async function runResync(playerIds: string[], batchSize: number, apply: boolean) {
  const report = {
    currentAchievementRows: 0,
    projectedRows: 0,
    progressChanges: 0,
    newCompletions: 0,
    unchanged: 0,
    completionCountByCode: {} as Record<string, number>,
    newCompletionCountByCode: {} as Record<string, number>,
    staleUnknownCodes: new Set<string>(),
    processed: 0,
    succeeded: 0,
    errors: [] as Array<{ player_id: string; error: string }>,
  };

  for (const [batchIndex, batch] of chunk(playerIds, batchSize).entries()) {
    const outcomes = await Promise.allSettled(
      batch.map((playerId) =>
        apply
          ? syncPlayerAchievements(playerId, { publishActivityEvents: false })
          : previewPlayerAchievementSync(playerId),
      ),
    );

    outcomes.forEach((outcome, index) => {
      report.processed += 1;
      if (outcome.status === "rejected") {
        report.errors.push({
          player_id: batch[index],
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        });
        return;
      }

      report.succeeded += 1;
      const plan = outcome.value;
      report.currentAchievementRows += plan.currentRows;
      report.projectedRows += plan.projectedRows;
      report.progressChanges += plan.progressChanges;
      report.unchanged += plan.unchanged;
      report.newCompletions += plan.newlyCompletedCodes.length;
      plan.staleCodes.forEach((code) => report.staleUnknownCodes.add(code));
      plan.projectedCompletedCodes.forEach((code) => {
        report.completionCountByCode[code] = (report.completionCountByCode[code] ?? 0) + 1;
      });
      plan.newlyCompletedCodes.forEach((code) => {
        report.newCompletionCountByCode[code] = (report.newCompletionCountByCode[code] ?? 0) + 1;
      });
    });

    console.log(
      `[achievements-resync][${apply ? "apply" : "dry-run"}] batch ${batchIndex + 1} processed`,
    );
  }

  return {
    ...report,
    staleUnknownCodes: [...report.staleUnknownCodes].sort(),
    failed: report.errors.length,
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    apply?: boolean;
    batchSize?: number;
  };
  const apply = body.apply === true;
  const batchSize = resolveBatchSize(body.batchSize);
  const players = await playerRepository.listOrderedByCreatedAtDesc();
  const result = await runResync(players.map((player) => player.id), batchSize, apply);

  return NextResponse.json({
    ok: result.errors.length === 0,
    mode: apply ? "apply" : "dry-run",
    batchSize,
    totalPlayers: players.length,
    ...result,
  });
}
