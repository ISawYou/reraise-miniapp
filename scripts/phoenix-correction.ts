/** Narrow owner-run operation. Bundle this reviewed source; run inside the deployed app.
 * Default is a read-only preview. No HTTP endpoint or client-supplied actor exists.
 */
import { PostgresPhoenixCorrectionRepository } from '@/lib/repositories/phoenix-correction/PostgresPhoenixCorrectionRepository';
import { PHOENIX_APPROVED_REVISION, PHOENIX_OWNER_CONFIRMATION, phoenixRevision } from '@/lib/phoenix-correction';

async function main() {
  const mode = process.env.PHOENIX_CORRECTION_MODE ?? 'preview';
  if (mode !== 'preview' && mode !== 'apply') throw Error('Invalid correction mode');
  if (process.env.DATABASE_PROVIDER !== 'postgres') throw Error('PostgreSQL required');
  const repository = new PostgresPhoenixCorrectionRepository();
  const actor = { kind: 'owner-release' as const, confirmation: PHOENIX_OWNER_CONFIRMATION };
  if (mode === 'apply') {
    if (process.env.PHOENIX_CORRECTION_CONFIRM !== PHOENIX_OWNER_CONFIRMATION ||
        process.env.PHOENIX_CORRECTION_REVISION !== PHOENIX_APPROVED_REVISION) {
      throw Error('Explicit owner confirmation and approved revision required');
    }
    return repository.apply(actor, PHOENIX_APPROVED_REVISION);
  }
  const p = await repository.preview(actor);
  if (p.status === 'already_applied') return { status: p.status, revision: p.revision };
  return {
    status: p.status, revision: p.revision, beforePool: p.beforePool, afterPool: p.afterPool,
    afterRevision: phoenixRevision({ tournament: p.afterTournament, results: p.afterResults,
      snapshot: { ...p.before.snapshot, ratingPlaces: p.afterPlaces } }),
    results: p.afterResults.map((r, i) => ({ id: r.id, playerId: r.playerId, place: r.place,
      before: p.before.results[i].ratingPoints, after: r.ratingPoints })),
  };
}
main().then(result => {
  process.stdout.write(JSON.stringify(result) + '\n', () => process.exit(0));
}).catch(() => {
  // Never serialize DB connection errors, URLs, credentials or player records.
  process.stderr.write('PHOENIX correction failed; no success claimed. Inspect protected diagnostics.\n', () => process.exit(1));
});
