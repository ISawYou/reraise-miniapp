# Staff late admission (migration 0037)

Self-registration remains closed after the deadline or a manual snapshot. Admins/operators use `admitTournamentPlayer` with the authenticated server actor; neither a client actor ID nor an isAdmin flag is accepted. Completed tournaments and qualification-final rosters are excluded. The existing picker is preferred; a genuinely new nickname is checked under a normalized nickname advisory lock.

The repository locks the tournament first, checks current phase, physical-attendance/no-show confirmation, capacity and FIFO, then writes registration, initial operational state and a private audit in one transaction. The permit is bound to tournament, player, backend and transaction and expires at successful admission/transaction end. A GUC alone grants nothing. Helpers and audit have no PUBLIC access. The trusted application DB role owns the objects; database-owner access remains privileged, not a replacement for server authentication.

Late confirmation contains the exact player/tournament and explains whether arrival can still join the eventual snapshot or existing placement values are frozen. No-show clearance additionally requires explicit physical arrival and confirmation, with the previous restriction saved in the audit. No automatic arrival is inferred. Request UUIDs make retries idempotent. Other expected deadline rejections return readable Russian text; unexpected failures remain failures.

Snapshot JSON and formula/guarantee/multiplier are not rewritten. Read models use the frozen number of rated places. A completion guard rejects a stale roster or placement values/pool inconsistent with the saved snapshot; the existing rating engine remains canonical. One initial stack can accompany confirmed physical arrival, never an extra re-entry/add-on. Live entries, attendance and initial-stack rows are synchronized without duplication.

## Controlled release

1. Verify remote main, no competing Actions, healthy app/DB, current immutable image ID/reference and canonical compose checksum. Retain the previous image; save sanitized before-state hashes for results, snapshots, settings and qualification data.
2. Stage A contains only 0037 SQL, its snapshot and journal. Historical SQL hashes are unchanged; legacy 0035 remains absent. Verify a fresh database and upgrade from 0036 locally. Disable Deploy and verify disabled_manually before merging the migration-only PR. Run production-migrations.yml explicitly on verified main with confirmation MIGRATE. Require verified backup, exact migration tracking hashes, expected functions/table/trigger, no audit entries, unchanged existing data and healthy unchanged runtime. Stop on mismatch.
3. Stage B is based on Stage A main, excludes all migration artifacts and unrelated work. Validate, commit, push and review the runtime-only PR. Merge while Deploy remains disabled. Verify resulting main SHA; enable Deploy and explicitly dispatch deploy.yml on main. Require workflow head SHA to equal that merge and verify immutable image, health and read-only smoke checks. Enabling alone does not replay the missed push.
4. Do not create production test players or silently admit ufo_lover. The owner must use the new admin picker and explicitly confirm any actual admission/physical presence. Real authenticated acceptance is pending until this is done. If the tournament has completed, this operation must reject admission.

## Rollback

Restore only the verified previous application image with the existing canonical compose/runbook; verify health and image ID. Keep PostgreSQL, migration tracking and additive audit schema. Do not restore/delete snapshots or results. The migration retains self-registration/stack deadline protections and does not globally disable triggers. If a DB guard causes an unforeseen operational blocker, stop and obtain a separately reviewed forward fix rather than deleting the migration or bypassing constraints.
