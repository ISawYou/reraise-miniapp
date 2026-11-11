# Native Support Chat V1 — runtime release candidate

## Architecture and authority

Player `/support` and staff `/admin/support[/id]` use authenticated JSON routes,
features and the PostgreSQL Repository Layer. Canonical identity is resolved by
the existing signed Telegram initData / signed website session mechanism; no
client player/recipient/sender identity is accepted. Both current `operator`
(administrator) and `admin` (super-administrator) can read/reply/close/reopen and
mark shared correspondence read. Their role semantics are unchanged. Blocked
staff cannot use staff routes. Blocked owners deliberately retain only their
own support contact path: the root gate exempts exact `/support`, not arbitrary
subpaths, and their normal navigation stays hidden. Existing game/block guards
are untouched. Anonymous visitors must authenticate on Home first.

There is one persistent thread per player, reopened for subsequent interactions.
History is paginated (50 messages), inbox pages contain30 threads, and polling
uses incremental message IDs every4seconds. Inbox first-page polling is5seconds;
expanded inbox pages retain their contents until explicit refresh. Staff unread
counts poll every15seconds. Read state is shared across staff, not a personal
assignment: opening a conversation acknowledges only IDs actually fetched.
Unread (not seen by staff) and unanswered (no subsequent staff reply) differ.

Writes serialize on the sender row and thread. A per-thread UUID client ID,
server-side sender/hash comparison and unique indexes prevent duplicate sends.
Retries retain the same UUID, including a session-scoped local draft after
refresh. Authenticated-owner keys prevent one user's draft appearing in another
user's chat;401/403 clears visible history. Successful delivery means persisted
in ReRaise, not read by a staff member. Failed/ambiguous requests remain retryable
with the same identifier. Text is trimmed, limited to4000 Unicode code points,
rendered as React text and never as HTML. No attachments or transcript export.
Rate limits are atomic:10 messages/minute per player and30/minute per replying
staff member, with retries recognized before the limit check. JSON-only mutation
routes reject foreign Origin headers. All support responses are private/no-store.

## Notifications are optional

The message, unread counters and notice outbox commit together before the
response. Next.js `after` dispatches only after persistence; failure to schedule
or send cannot change the saved message result. The existing Telegram sender
is reused with support-only5second timeouts and a generic message/link. Existing
team/tournament notification behavior is unchanged. No player name, nickname or
message body appears in Telegram. Current DB roles, canonical/unblocked state
and Telegram ID are checked before each recipient claim. Demoted, blocked,
merged and missing-ID recipients are skipped. Actual ability to receive messages
is determined by the API result; it cannot be known from Telegram ID alone.

One wave is queued when an answered thread becomes unanswered; consecutive
player messages produce no extra wave. Unique per-thread/generation/recipient
claims prevent concurrent duplicate dispatch. Definite/boolean sender failures
retry at most3 times, spaced5minutes apart, on later sends or maintenance runs.
A sender crash leaves an ambiguous `sending` claim, which is marked failed after
60seconds rather than blindly resent. Network ambiguity can still duplicate an
optional generic alert within the3-attempt bound: Bot API has no idempotency key.
There is no claim of exactly-once external notification. Shared unread counters
and in-app delivery remain functional with no bot token, webhook or Bot API.
The bot token remains necessary for the existing Telegram initData verification;
website signed sessions do not require it. There are no incoming-webhook support
operations and the existing bot commands/webhook are unchanged.

## Retention and actual execution

Only answered open threads with a staff reply and at least14days inactivity are
auto-closed. Staff cannot manually close an unanswered request. New player text
or explicit reopening clears closure/expiry and resets inactivity. GET/polling
never creates a thread or postpones retention.

30days after closure, cleanup sets message bodies to NULL, at most1000 bodies
per invocation and at most100 eligible threads (default50). IDs, sender metadata
and body hashes remain for audit/idempotency; previews derive from message bodies
and therefore disappear too. Purged history is displayed explicitly. Unanswered
threads, even inconsistent closed/unanswered ones, are never purged. Cleanup and
reopening serialize on thread locks; already purged content cannot be restored.
Explicit pre-existing account deletion follows FK cascade; it is separate from
automatic retention. No new account deletion or merge behavior is introduced.

`POST /api/internal/support/maintenance` requires a dedicated server-only
`SUPPORT_MAINTENANCE_TOKEN` (at least32chars), constant-time Bearer comparison,
explicit JSON `dryRun` and limit1..100. Dry-run returns aggregate counts, writes
nothing and sends no alerts. Apply also drains at most20 optional notices.

The new `support-maintenance.yml` runs daily03:15UTC (06:15Moscow) and supports
manual dry-run (defaulttrue). It is inert unless repository variable
`SUPPORT_MAINTENANCE_ENABLED=true` is explicitly enabled. Configure matching
server/GitHub secret first. The scheduled apply call uses limit50; large backlogs
require additional bounded authorized calls. Cleanup timing is daily, so expiry
may be processed up to roughly24hours later. No public/owner session can trigger
maintenance and no maintenance token is returned to clients. No production job
or endpoint was executed in this implementation pass.

## Migration and release sequencing

The previous19-file incident repair was retired by owner-authorized cleanup.
Its exact contents and hashes remain recoverable in the verified cleanup archive;
the original incident worktree is clean. Unfinished0035 is not released. This independent implementation reserves0036 and
journal idx36 intentionally (idx35 is not reused). Its snapshot directly follows
main's0034; the journal does not include or depend on the old correspondence
migration. The gap is supported and verified by actual Drizzle migrations on a
disposable database. Do not merge the obsolete0035 branch later without a new
journal/snapshot/domain review; the forwarding model is not this chat model.

### Release gates (Stage A completed; Stage B pending)

The current `deploy.yml` runs automatically on **every push to main**, without
path filters. A schema-only merge would therefore deploy the previous runtime
again. `production-migrations.yml` accepts only `refs/heads/main`; running it
from this feature branch is not supported. Merely merging this whole candidate
and then dispatching migrations is unsafe. The shared `production-deploy`
concurrency group serializes jobs, but does not guarantee migration-first order.

Stage A — completed through PR11; retain these gates as the release audit:

1. Recheck remote main and approve the exact split. The Stage A PR must contain
   **only** `lib/db/migrations/0036_native_support.sql`,
   `lib/db/migrations/meta/0036_snapshot.json` and
   `lib/db/migrations/meta/_journal.json`. No ORM exports, runtime, compose or
   maintenance workflow belong in this PR. Verify all existing journal entries,
   SQL SHA-256 hashes and snapshots against main; append only idx36. Do not
   install unfinished0035 and do not merge the old incident-repair branch.
2. Drain existing production deployment/migration runs and confirm no competing
   release. Record the running app SHA, exact image ID, immutable reference/digest,
   healthy status, canonical compose checksum and a protected copy of that
   compose beside the original in `/opt/reraise`. Confirm the rollback image
   is still available. Do not print environment variables or credentials.
3. **Before the Stage A merge**, suspend automatic deployment:
   `gh workflow disable deploy.yml --repo ISawYou/reraise-miniapp`.
   Verify `gh api repos/ISawYou/reraise-miniapp/actions/workflows/deploy.yml --jq .state` returns `disabled_manually`, and verify there are no queued,
   waiting or running Deploy jobs. Stop if this gate cannot be established.
   Do not rely on a commit-message skip directive or the concurrency group.
4. Merge only the reviewed schema PR. Record the actual Stage A main SHA; verify
   its exact three-file scope and that no Deploy run started. Keep Deploy disabled.
5. Dispatch the existing migration workflow on that main SHA's branch:
   `gh workflow run production-migrations.yml --ref main --repo ISawYou/reraise-miniapp -f confirmation=MIGRATE`.
   Prevent intervening main merges; verify the run's `headSha` is the recorded
   Stage A SHA. It builds only the immutable migrator on GitHub, validates the
   production DB identity and applied hash-prefix, creates a verified dump,
   migrates and compares the complete tracking chain. No VPS build or app restart.
6. Wait for success, record the run ID and verified backup path. The existing
   workflow's domain-specific table check covers `club_activity_events`, **not
   support tables**; add a separate read-only schema acceptance gate. In a
   read-only transaction verify all three support tables, their five FKs,
   eleven indexes (including three PK indexes), ownership/client-ID unique
   indexes and check constraints against0036/snapshot. Compare every tracked
   `created_at|hash` with the approved journal/SQL chain: exactly the prior0034
   prefix plus0036, no0035. Compare the old schema/table-count evidence and
   app container ID/start time/health to their pre-migration values. Do not read
   private correspondence or print player data. Any mismatch blocks Stage B.

Stage B — only after Stage A schema acceptance:

1. Prepare the remaining runtime PR on the new main. Its diff must exclude the
   already merged schema files and preserve the reviewed candidate contents.
   Repeat targeted authorization/security checks if conflict resolution changes
   code. The candidate cannot be merged whole before the Stage A gate.
2. Verify `SUPPORT_MAINTENANCE_ENABLED` is absent or false. Do not activate cleanup
   or change Telegram webhook, commands, token or Mini App entry point.
3. Use **strategy A**: keep Deploy disabled during the runtime PR merge.
   Before merge, verify main is exactly the accepted Stage A SHA, the PR contains
   only the reviewed runtime candidate, schema acceptance still holds and there
   are no competing jobs/changes. Record the actual runtime merge SHA. Recheck
   its exact diff and head identity while Deploy remains `disabled_manually`.
   Only after separate runtime release authorization, enable Deploy and verify
   its state is `active`; then **explicitly dispatch** `deploy.yml --ref main`
   after checking main equals that recorded merge SHA. The existing workflow
   requires `github.ref == refs/heads/main`; do not dispatch a raw SHA or feature
   ref that would skip build/deploy. Verify the created run's `headSha` matches
   the recorded merge SHA before accepting it.
   Keep other main merges/manual deployments frozen through this gate. Enabling
   Deploy alone does not replay the missed push. If main/run SHA differs, STOP.
4. Monitor checks, immutable GHCR build, app-only VPS recreate and automatic
   health/HTTP smoke. Record the actual merge SHA, Actions run, image ID/reference
   and canonical compose checksum. No VPS build or changes to database containers,
   Docker networks or unrelated containers.
5. Perform real website and Telegram cold-start authentication; own history and
   retry/reload; both staff roles/inbox/reply/read/close/reopen; blocked-account
   support; anonymous rejection and cross-player isolation. Sending smoke-test
   messages creates production data and needs explicit test-write authorization;
   until then keep those acceptance items pending. Verify generic alerts link
   to the exact `/admin/support/<thread UUID>` and that failure never loses a
   persisted message. Use only authorized test accounts and no private logs.
6. Configure the dedicated maintenance secret in server/GitHub separately, run
   an authorized dry-run and inspect aggregate counts. Activate the scheduled
   variable only after explicit approval. This local review enables nothing.

Rollback:

- Stage A failure: keep Deploy disabled, preserve migration/backup diagnostics,
  verify old runtime health and stop. Do not proceed to runtime or automatically
  restore/drop database objects. A partially applied chain needs separate review.
- Stage B failure: existing Deploy auto-rollback targets the previous app image
  and unpromoted old compose; verify its outcome. For failure found after deploy,
  stop competing runs, hold the same `/var/lock/poker-production.lock` and recreate
  **only app** from the captured immutable image using the preserved previous
  compose (`RERAISE_IMAGE=<verified previous image ID> docker compose
  -f /opt/reraise/<verified previous compose file> up -d --no-deps app`). Verify
  exact image, running/healthy status, `/api/health`, Home/settings/leaderboard.
  Never use `down`, restore DB, delete support rows or roll back additive schema.
  Preserve messages, diagnostics and the backup. Leave cleanup disabled.

Stage A completed through PR11 at main `f64578d43e15d1ada28b1b34f267a15de2d625d8`:0036
was applied with verified backup; the previous application remained unchanged.
This Stage B preparation creates a runtime PR only. No runtime merge, deployment,
production data writes, live test messages or scheduler activation are authorized
in this preparation. Actual Telegram/browser acceptance remains pending release.
