# Desktop tournament console: owner review and release

Candidate continues PR #21 on PR #20. Production is unchanged. The consolidated work after `6e233ac` is prepared for review in the same draft PR; merge and deployment require separate owner authorization.

## Administrator workflow

Open **Турниры → Управление турниром** in a computer browser. New PostgreSQL tournaments expose applicable operational fields for their canonical type. Blank operation values mean unknown. Payment fields are bookkeeping markers; free re-entry usage does not modify the player's balance. Tab/Enter saves numeric cells; checkboxes save immediately. Errors retain the draft and offer an explicit retry after checking current persisted values.

Owner payment update: **Оплачен** is a simple checkbox; obsolete payment method is hidden and is never required for completion. Historical `payment_method` values and legacy Sheet parsing are retained. **Комментарий** is optional per tournament/player (including active qualification finals), saves on blur, is limited to 1000 characters in API/UI/DB, and uses the existing operation version/audit. Untouched comments stay null. Sheet cutover has no comment source and does not fabricate text. Comments and their version/audit timestamps are excluded from the completion fingerprint and never enter rating/results/financial inputs.

Final blocker correction: PHOENIX hides free re-entry usage and rejects nonzero usage in operation writes, source comparison/cutover and both completion paths. Stored historical values are not erased or normalized; an active invalid value blocks completion/cutover pending explicit correction. The old results screen checks ownership before completion: PG-owned tournaments navigate to `/control` before legacy validation/submission. A stale legacy POST against PG ownership returns `409 POSTGRES_CONSOLE_REQUIRED` with an internal console destination and performs no completion/Sheet write. Legacy Sheet completion keeps its previous body/behavior. If ownership changes during submission, the old screen rechecks and navigates rather than reporting a misleading completion.

The console refreshes operations and live-state every 15 seconds, preserving focused/dirty cells and ignoring older operation versions. Entries/Add-on share a per-player save queue. Unsupported KO/Boss/Mystery fields are rejected server-side. Phoenix hides Add-on and keeps its canonical two-entry maximum. Qualification final stays in the existing qualification roster/completion workflow.

For Mystery, independently enter physical envelopes won and points. The summary compares assigned quantities against the existing frozen snapshot. Completion rejects unknown or mismatched envelope/point totals.

Use existing links for admissions, walk-ins, late-registration close, elimination order and return-to-game. Eliminated players' finishing places follow the canonical elimination order. Active players' places can be entered manually. **Проверить завершение** calculates through the existing engine and frozen rating places. Review results and explicitly confirm. A changed fingerprint rejects stale completion; repeated completion is rejected. Poker Clock's finish remains a post-completion side effect.

## Explicit cutover

Existing linked tournaments stay `LEGACY_GOOGLE_SHEETS`. An admin opens **Перейти на управление в РЕРЕЙЗ**, reviews fresh Sheet/PostgreSQL comparisons and chooses a source for every conflict. Unknown stays null. Confirm the imported values and ownership change. Changing or clearing a Sheet URL is not a cutover.

The transaction takes an exclusive advisory lock corresponding to shared leases used by the poller, roster writers, Sheet reconciliation and write-through/export paths. It re-reads both sources, checks the reviewed hashes, imports operational facts and audit, and changes ownership atomically. Retries with the same request ID return the prior successful result. The Sheet link remains stored as archive; PG-owned runtime reads hide it from legacy Sheet behavior. PG completion performs no Sheet read/export.

Safety refusals: special qualification finals/paid-cash cutover are not imported through the free-tournament Sheet parser; use their existing workflows pending separate format review. An eliminated player whose PostgreSQL timestamp is missing cannot receive a fabricated timestamp from import: first verify the canonical elimination order. These conditions fail with zero cutover writes. Human Sheet edits after a comparison require a fresh comparison; the cutover imports the explicitly reviewed snapshot, not later external edits.

## Migration-first production procedure — separate owner authorization required

1. Verify the final PR head/file manifest and checks; verify current main and absence of competing production jobs. Record running SHA, immutable image ID/digest, compose checksum and public health. Confirm the previous image remains available for application rollback.
2. Temporarily disable `deploy.yml`; verify `disabled_manually` and no queued/running production jobs. A push to main otherwise deploys automatically.
3. Release only the reviewed migration artifacts first. Use the existing `production-migrations.yml` from the verified migration merge SHA with `confirmation=MIGRATE`. Require verified PostgreSQL backup and exact tracking-hash prefix before applying anything.
4. Local candidate chain adds 0039 operations/audit, 0040 nullable envelope usage, 0041 completed-operation guards, 0042 explicit ownership and legacy-link backfill, 0043 source-switch audit. Historical migrations through 0039 were verified unchanged against `6e233ac`; 0039 is still not applied to production. Release must include it. Verify all pending migration hashes, generated snapshot lineage and actual tables/constraints/functions after migration. Verify frozen snapshots/results and player balances against pre-migration hashes. Linked existing tournaments must remain legacy-owned.
   Include additive 0044 (`tournament_operation_comments`): nullable comment and database length constraint. Do not drop the historical payment-method column or rewrite migrations 0039–0043.
5. Merge the reviewed runtime while Deploy is disabled. Verify actual main merge SHA, then enable Deploy and explicitly dispatch `deploy.yml --ref main`; re-enabling alone does not replay the missed push. Confirm run `headSha`. Monitor lint/typecheck, GHCR build and VPS application deployment/health. Never build on VPS.
6. Accept website staff authentication, own console, role rejection, actual operation saves, two-tab conflicts, frozen snapshot preservation, canonical admissions/Poker Clock and one controlled PostgreSQL tournament. No live testing writes without separate owner authority.
7. Only after runtime acceptance, the owner may explicitly cut over individual reviewed tournaments using the new interface. Deployment does not automatically switch existing linked tournaments.
8. On critical runtime failure restore only the verified previous application image/compose and verify health. Retain the additive schema and audit; do not downgrade/restore PostgreSQL. If a tournament has already been cut over, the old runtime does not understand source ownership: pause staff/Sheet activity and prefer a forward fix. Application rollback is not sufficient authorization to resume the old synchronizer against switched tournaments.

## Evidence available locally

- 148 focused unit/API/UI tests passed across console, canonical rating/type validation, legacy Sheet sync/completion, operation/source auth and stale preview behavior.
- Payment/comment update: 155 focused tests passed, including blur-only autosave, checkbox payment, optional comments, failure draft preservation, readonly controls and unpaid/free-roll completion without payment method. Real PostgreSQL tests check the comment length constraint, audit/version, unknown cutover comment and unchanged completion fingerprint after a comment edit.
- 3 actual PostgreSQL integration scenarios passed on upgraded and freshly migrated disposable databases: operation/version/audit behavior, atomic reviewed cutover/advisory race/idempotency, and canonical PG completion without Google reads.
- Separate 0039→0043 upgrade verification preserved historical results/snapshots/players, verified all 43 tracked SQL hashes, kept linked ownership legacy and confirmed clearing the Sheet link does not switch ownership.
- Real authenticated Chromium `/control` at 1366 and 1920 with 60 disposable PostgreSQL players: actual KO persistence, completion preview, sticky behavior, no document overflow, GS/completed readonly controls and unauthenticated API 401.
- Screenshots: `/private/tmp/console-real-1366.png`, `/private/tmp/console-real-1920.png`.
- Final TypeScript, changed-file lint and `git diff --check` passed. Production build passed after correcting nine Sheet Server Action wrappers to explicitly declare `async`. The affected Sheet sync suite was rerun: 48 tests passed. Build retains Edge Runtime import warnings, including `node:async_hooks` through the source-fence module; this is not claimed as warning-free.
- Final blocker correction verification: 79 focused tests passed; 5 actual PostgreSQL integration scenarios passed, including Phoenix API/cutover/completion rejection and editable qualification-final comments with confirmed invitations and unchanged special completion guards. TypeScript, changed-file lint and production build passed. No additional schema migration was needed.

## Remaining acceptance gaps

No production acceptance or actual Google credential/network acceptance is claimed. Cutover Google reads are replaced by fixture Sheet responses in the real PostgreSQL integration test; the DB transactions/locks/import/audit are real. Browser QA uses authenticated disposable PostgreSQL, not mocked save endpoints. Existing attendance/elimination/entry APIs retain their established processed-order semantics; optimistic version checks cover the new operation fields. A stricter cross-tab CAS contract for those existing live APIs remains a release-review consideration.
