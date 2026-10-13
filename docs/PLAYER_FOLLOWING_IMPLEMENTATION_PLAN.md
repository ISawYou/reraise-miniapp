# Player Following — Re-Raise (as built)

Status: **Batches A–F implemented locally; NOT committed, NOT pushed, NOT deployed, migration `0031` NOT applied to production.** Release steps are in §14.

History: the file started as the pre-implementation audit/plan (2026-10-13, `main` @ `febcf9c`). It has been converted to a record of what was actually built. The original Sterling behaviour contract, the architecture findings that drove the design and the decision log are kept in condensed form (§1–§3); everything else describes the shipped behaviour.

Sources: Sterling's `PLAYER_FOLLOWING_SYSTEM_AUDIT.md`, `…_PORTING_GUIDE.md`, `…_FILE_MAP.md` (supplied by the product owner, not in this repo) define *what* the feature does. Production facts follow `CLAUDE.md`: one VPS, PostgreSQL (`DATABASE_PROVIDER=postgres`); Supabase code is legacy and plays no part in this feature.

---

## 0. TL;DR

| Topic | As built |
|---|---|
| Edge | `follows(follower_player_id → followed_player_id)`; "A follows B" = `follower = A`, `followed = B`. |
| Storage | PostgreSQL only (Drizzle), migration `0031_overjoyed_onslaught`. No Supabase implementation, no RLS. |
| Transport | REST route handlers under `app/api/players/[id]/…`; client uses `fetchAdminJson` (initData header) for the summary and `fetchJsonWithRetry(…, 0)` + `getAdminHeaders()` for mutations. No Server Actions. |
| Auth | `lib/follows-auth.ts` over `resolveAuthenticatedCaller` (initData HMAC ≤ 1 h **or** signed `reraise_session` cookie, canonical-merge resolution), blocked ⇒ no viewer, stale-initData → cookie fallback (D7). |
| CSRF | POST/DELETE `follow` run an Origin gate first (`lib/request-origin.ts`): foreign origin ⇒ 403, no same-origin evidence ⇒ cookie ignored (initData only). §9. |
| Merge | `moveFollows` inside the shared `moveMergeHistory` (both merge entry points, same SERIALIZABLE transaction). |
| UI | Profile: button + two counters + list modal. Leaderboard: «Все / Подписки» chips inside «Текущий сезон». |
| Rank | Official season rank (D2); `rank = index + 1` of the server-sorted official list, attached **before** filtering. |
| Out of scope (unchanged) | notifications, feed, analytics, rating deltas, private profiles, blocklists, rate limiting, search, admin tooling. |

---

## 1. Sterling behaviour contract (condensed)

Scope: directed edge; Follow/Unfollow on **another** player's profile for signed-in viewers; two counters (Подписчики / Подписки) each opening a newest-first list; leaderboard «Подписки» view of the **season** leaderboard = *me + players I follow*.

Invariants kept: unique `(follower, followed)`; self-follow rejected in the service **and** by a DB CHECK; both FKs cascade; follow and unfollow are idempotent (never 409 for an existing/missing edge); follower id only from the verified session; target must exist; generic Russian error copy, real error logged server-side only; counters always rendered; pessimistic button, no confirmation dialog.

Sterling defects deliberately **not** copied: merge ignores follows · cookie-only Server-Action auth · hard 50 cap truncating the leaderboard filter · no id validation / raw DB errors to the client · local ±1 count arithmetic · counter failure killing the profile · redundant index · no ordering tiebreak.

---

## 2. Architecture findings that shaped the design (condensed)

- **Identity.** `resolveAuthenticatedCaller(headers, cookies)` (`lib/admin-auth.ts`): `X-Telegram-Init-Data` header ⇒ HMAC with the bot token, `auth_date` ≤ 3600 s, `findByTelegramId`; otherwise the `reraise_session` cookie (HMAC of the player id with `SESSION_SECRET`, `lib/telegram-web-session.ts`). Both go through `resolveCanonicalPlayer` (follows `merged_into_player_id`). An invalid/expired header yields `null` and never reaches the cookie — the gap D7 closes for follows only. `lib/admin-auth.ts` is deliberately untouched (shared with middleware and admin).
- **Cookie.** Set by `/api/auth/telegram/mini-app-session` (`SameSite=None` in production, 30 d), `/api/auth/telegram/callback` and `/api/auth/email/verify-code` (`SameSite=Lax`). Telegram Web/Desktop may not keep cookies, which is why Teams/dealer/admin screens use `fetchAdminJson` (header).
- **Data layer.** Drizzle + `postgres-js`; Postgres-only repositories are an established pattern (`club-activity`, `team*`). `players.id` is `uuid`; players are soft-merged (`merged_into_player_id`) and hard-deleted only for manual players (`deleteManualPlayer`, relies on FK cascades).
- **Leaderboard.** `GET /api/leaderboard` returns `{ season, leaderboard, outOfCompetition }`; `features/leaderboard.ts::partitionOfficial` assigns `officialRank = leaderboard.length + 1` while walking the sorted array, and the server adds `rankMovement` with `.map` (order preserved) ⇒ **official rank == array index + 1**. «Вне зачёта» players are separate and rank-less. The client renders place numbers from the same index.
- **Transport.** Teams pattern chosen over Server Actions: only the header reliably proves identity in Telegram Web/Desktop, and HTTP statuses are a real contract.

---

## 3. Decisions (all owner-approved)

| ID | Decision | Final |
|---|---|---|
| D1 | Counts and lists public (incl. anonymous); no `username` in payloads | as planned |
| D2 | Leaderboard «Подписки» uses the **official** season rank, not a subset rank | as planned |
| D3 | Lists paginated (default 50, max 100) + separate unbounded `following/ids` | as planned |
| D4 | «Все / Подписки» chips inside «Текущий сезон»; no 4th tab | as planned |
| D5 | No notifications / feed / analytics | as planned |
| D6 | Blocked **targets** followable; blocked **viewers** cannot mutate (401) | as planned |
| D7 | Stale initData → valid-cookie fallback, in follows auth only | as planned |
| F1 | CSRF Origin gate on follow mutations | approved in Batch F (§9) |
| F2 | Leaderboard case C shows the no-results note while keeping the viewer's row | approved in Batch F (§12) |
| F3 | Unchanged: blocked-viewer button UX, merged-away profile behaviour, no follower-side ordering index, notification scope, rating logic, pagination architecture | approved in Batch F |

---

## 4. Database

`lib/db/schema/follows.ts`; migration `lib/db/migrations/0031_overjoyed_onslaught.sql` (+ `meta/0031_snapshot.json`, `_journal.json` idx 31, `prevId` → `0030`). `drizzle-kit check` is clean; the migration applies cleanly to an empty database.

```
follows
  id                  uuid PK default gen_random_uuid()
  follower_player_id  uuid NOT NULL → players(id) ON DELETE CASCADE
  followed_player_id  uuid NOT NULL → players(id) ON DELETE CASCADE
  created_at          timestamptz NOT NULL default now()
  CHECK follows_no_self_follow (follower_player_id <> followed_player_id)
  UNIQUE follows_follower_followed_key (follower_player_id, followed_player_id)
  INDEX  follows_followed_created_idx (followed_player_id, created_at DESC NULLS FIRST, id DESC NULLS FIRST)
```

- `NULLS FIRST` is deliberate: Drizzle's default `DESC` index is `NULLS LAST`, which the planner would not match to `ORDER BY … DESC`. The first generated migration was discarded and regenerated.
- No RLS (same as `club_activity_likes`; the server is the only writer).
- **No follower-side ordering index** `(follower_player_id, created_at DESC, id DESC)` — deliberately deferred (§10).

## 5. Repository

`lib/repositories/follow/{FollowRepository, PostgresFollowRepository, index}.ts` (barrel-exported). No business logic; the feature layer owns existence/merge rules.

| Method | Semantics |
|---|---|
| `create(follower, followed)` | `INSERT … ON CONFLICT DO NOTHING` (idempotent) |
| `delete(follower, followed)` | no-op when the edge is absent |
| `exists(follower, followed)` | directed |
| `countFollowers(id)` | rows where `followed_player_id = id` |
| `countFollowing(id)` | rows where `follower_player_id = id` |
| `listFollowers(id, limit, offset)` | joins the **follower** side; `ORDER BY created_at DESC, id DESC`; fields `id, display_name, telegram_avatar_url, custom_avatar_url` only |
| `listFollowing(id, limit, offset)` | joins the **followed** side; same order and fields |
| `listFollowingIds(id)` | `SELECT followed_player_id WHERE follower_player_id = id`, **unbounded** |

## 6. Service, auth and API

- `features/follows.ts` (plain module, no `"use server"`): typed domain errors; `lib/uuid.ts::isUuid` rejects malformed ids before any DB access (400 «Некорректный идентификатор игрока»); follow = self-check (400) → `findById` target (404 «Игрок не найден») → merged-away target (409 «Аккаунт был объединён. Обновите страницу.») → `create` → fresh **target** counts. Unfollow does not require the target to exist. `getFollowSummary` degrades per field (`null`) and answers `isFollowing:false` for anonymous/own profile without a DB hit.
- `lib/follows-error-response.ts`: `instanceof` mapper that **never** forwards an unknown error message; unknown errors are logged and answered with the route's fixed fallback text.
- `lib/follows-auth.ts`: `resolveFollowViewer` / `requireFollowViewer` / `assertFollowMutationOrigin`. Blocked ⇒ `null`. D7: when the header path yields no actor **and** an initData header was sent, retry once with the header withheld (cookie only). A header that resolved to *any* actor is final — no fall-through to another identity.

| Endpoint | Auth | Success | Errors |
|---|---|---|---|
| `POST /api/players/:id/follow` | required + Origin gate | `200 {following:true, followers, following_count}` (target's counts; idempotent) | 401 · 403 `Недопустимый источник запроса` · 400 bad id / self · 404 · 409 merged-away target only · 500 fixed text |
| `DELETE /api/players/:id/follow` | required + Origin gate | `200 {following:false, followers, following_count}` (idempotent) | 401 · 403 · 400 · 500 fixed text |
| `GET …/follow-summary` | optional (only decides `isFollowing`) | `{followers, following, isFollowing}` each nullable | 400 · 500 only if every part failed |
| `GET …/followers?limit&offset` | public | `{items, total}` | 400 · 500 |
| `GET …/following?limit&offset` | public | `{items, total}` | 400 · 500 |
| `GET …/following/ids` | public | `{ids}` — every followed id, no cap | 400 · 500 |

`limit` defaults to 50 and is clamped to 1..100; invalid `limit`/`offset` fall back to defaults. A well-formed but unknown id on GETs gives `0`/empty (no 404, like `rating-summary`). Request bodies and query strings are never read by the mutations, so nothing the client sends can name or override the follower. All routes are `force-dynamic` and authorise themselves (`middleware.ts` only covers `/api/admin/**`).

## 7. Account merge (`lib/player-merge.ts::moveFollows`)

Called from the shared `moveMergeHistory(tx, targetId, sourceId)`, so **both** `executeMerge` (self-service) and the admin merge run it inside their SERIALIZABLE transaction. Order matters:

1. delete direct edges `source↔target` (they would become self-follows);
2. delete source **outgoing** edges whose `followed` the target already follows;
3. delete source **incoming** edges whose `follower` already follows the target;
4. `UPDATE follower_player_id: source → target`;
5. `UPDATE followed_player_id: source → target`.

The existing TARGET row wins collisions; surviving rows keep their `id` and `created_at`; raw `sql` subqueries (alias `existing`) are used so the mocked executor of `player-merge.test.ts` keeps working; the repository is not used (transaction scope). Nothing references SOURCE afterwards, and a failing merge rolls the follows move back with everything else (tested).

## 8. Client

- `lib/client-request.ts::getAdminHeaders()` (**shared, C.1**): returns `{}` immediately when `!isTelegramMiniAppContext()`, otherwise the `X-Telegram-Init-Data` header. Before this, every non-Telegram request waited ~1.2 s polling `getTelegramInitData`. Telegram behaviour is unchanged. Covered by `client-request.test.ts` and `telegram-context.test.ts`; **not proven on real Telegram clients** (§14 smoke).
- `lib/follows-client.ts`: `fetchFollowSummary`, `followPlayerRequest`, `unfollowPlayerRequest` (mutations: `fetchJsonWithRetry(url, init, 0)` + `getAdminHeaders()`, no retry), public list helpers `fetchFollowers` / `fetchFollowing`, `fetchFollowingIds`, `FOLLOW_LIST_PAGE_SIZE = 50`. Only the four public list fields are copied.

### Profile (`app/players/[id]/page.tsx`)
- The summary loads in its **own** `useEffect`, never inside the profile's `Promise.all`; any failure hides only the follow block. State is tagged with the player id and guarded by refs against stale responses.
- Button «Подписаться» / «Отписаться» (`...` + disabled while in flight) only for a signed-in viewer on **another** player's profile with `isFollowing !== null`. Pessimistic: counters are **replaced** by the response's canonical counts (no ±1), double clicks are blocked by `followBusyRef`, errors show a red line that clears on the next attempt.
- Counters «Подписчики» / «Подписки» are buttons (`data-testid="follow-followers"/"follow-following"`) visible to everyone, including anonymous; a `null` count hides only that counter; `0` is shown.
- Unchanged by decision: a blocked viewer still sees the button and gets the 401 text; a merged-away profile stays the same page after a 409.

### List modal (`components/follows/follow-list-modal.tsx`)
Bottom sheet (`max-h-[75vh]`), `useBodyScrollLock`, Escape / backdrop / × close. Public GET, direction by mode, first page 50, «Показать ещё» (double-click lock, `offset` = rows actually received, dedupe by id without reordering, an empty page ends pagination), loading / empty «Пока никого нет» / local error states, stale responses dropped, rows link to `/players/{id}` and close the sheet.

### Leaderboard (`app/leaderboard/page.tsx`, `lib/leaderboard-following.ts`)
- «Все» (default) and «Подписки» chips inside «Текущий сезон»; «Всё время» and «Статистика» are untouched.
- `GET /api/players/{me}/following/ids` is fetched lazily on the first open of «Подписки», cached per player; anonymous viewers make **no** request. A failing request shows a local error with «Повторить» (never the empty state).
- `filterFollowingStandings(rows, ooc, me, ids)` = `rows.map((row, i) => ({row, rank: i + 1})).filter(me ∪ followed)` — rank is attached **before** filtering; original order kept; the viewer is always included; followed «Вне зачёта» players stay in the dimmed, rank-less block. Flat list: no podium, no «ТОП-9 → Финал месяца» chip; subtitle «Игроки, на которых вы подписаны». `rankMovement` stays on its own row.
- **Official rank semantics.** The place number in «Подписки» is the player's place in «Все» (gaps such as #2, #7 are expected). Tied ratings already receive distinct sequential places on the server.

## 9. CSRF protection (Batch F)

Threat: the production `reraise_session` cookie is `SameSite=None`, so a third-party page can make a victim's browser send it with a cross-site `POST /api/players/:id/follow` and the cookie alone would authenticate it. A Telegram initData header cannot be attached cross-site without a CORS preflight this app never grants.

No Origin/Referer/`Sec-Fetch-Site`/CSRF helper existed in the repository, so the smallest possible one was added: `lib/request-origin.ts::classifyRequestOrigin(request)` → `"same-origin" | "cross-origin" | "unproven"`.

| Evidence | Verdict |
|---|---|
| `Sec-Fetch-Site` = `cross-site` or `same-site` | cross-origin |
| `Origin` present and equal to one of the request's own hosts (`X-Forwarded-Host` first value, `Host`, `request.url`, the host of `NEXT_PUBLIC_APP_URL`); `https` always, `http` only for loopback or non-production | same-origin |
| `Origin` present but foreign, `null`, malformed, with a path/query/userinfo, or plain `http` in production | cross-origin |
| no `Origin`, `Sec-Fetch-Site: same-origin` | same-origin |
| no `Origin`, no/`none` `Sec-Fetch-Site` (non-browser client, very old WebView) | unproven |

`assertFollowMutationOrigin(request)` (in `lib/follows-auth.ts`) runs **before** authentication in both mutations: cross-origin ⇒ `403 {"error":"Недопустимый источник запроса"}` (fixed text, no redirect, nothing written, the viewer is not even looked up); same-origin ⇒ normal auth; unproven ⇒ `allowCookie:false` — only a verified initData header can authenticate, the cookie jar is withheld and the D7 fallback is therefore impossible. This is a gate on ambient credentials, never an identity: `x-player-id` / body / query ids stay irrelevant, and no unverified identity is ever accepted.

- No hardcoded hostname and no foreign-origin allowlist; the expected host comes from the request and the app's own configured URL. A cross-site attacker cannot make those match for a request that carries the victim's cookies.
- Browsers always send `Origin` on same-origin POST/DELETE (default referrer policy), so normal web and Telegram Mini App traffic is classified same-origin. A cookie-only request without any Origin evidence is rejected with 401 **by design**.
- GET routes are unchanged (public reads, `follow-summary` optional auth).
- **Operational note.** The check relies on the public host reaching the app (`Host`/`X-Forwarded-Host`) or on `NEXT_PUBLIC_APP_URL` matching the host users use (apex vs `www`). If nginx rewrote `Host` and `NEXT_PUBLIC_APP_URL` pointed at a different host, follows would answer 403 and log `[follows-auth] mutation refused: cross-origin request` with the offending Origin — the Telegram smoke test in §14 catches this on both `re-raise.ru` and `www.re-raise.ru`.
- Tests: `lib/__tests__/request-origin.test.ts` (14), `app/api/players/[id]/follow/__tests__/follow-csrf.test.ts` (18), plus two CSRF cases against the real database in the lifecycle suite. Verified by mutation (guard removed ⇒ 8 failures).

## 10. Performance and the follower-side index decision

`EXPLAIN ANALYZE` on a disposable PG16 with 7040 edges (one player with 5000 followers and 2000 followings): followers page — index scan on `follows_followed_created_idx`, 0.29 ms; following page of 2000 — top-N sort 28 kB, 1.3 ms (of 40 — 0.1 ms); `following/ids` on 2000 — 0.27 ms; counts 0.24 / 0.36 ms; `exists` 0.03 ms. The profile does three tiny queries; the leaderboard filter is client-side.

**Decision: do not add `(follower_player_id, created_at DESC, id DESC)`.** Sorting a few hundred rows is negligible at club scale. Revisit only when a player has tens of thousands of followings or the table passes ~1 M rows. No migration `0032`; `0031` is unchanged.

## 11. Concurrency (classified in the pre-release audit)

Parallel duplicate follows — safe by the unique index + `ON CONFLICT` (tested with 25 concurrent inserts). Follow/unfollow races, counts recomputed after a write outside a transaction, page shifts while paginating, an edge landing on a player in the middle of a merge, and hard-delete vs follow (FK ⇒ fixed error text) are **acceptable for v1**; the UI always trusts the server's counts and dedupes list rows. Nothing needs hardening before release.

## 12. Leaderboard «Подписки» — final empty-state semantics

| Case | Viewer | Followed | Shown |
|---|---|---|---|
| A | has a result | none followed | no rows · global «Ваша позиция» · «Вы пока ни на кого не подписаны» |
| B | no result | none followed | no rows · «Пока без позиции» · «Вы пока ни на кого не подписаны» |
| **C** | has a result (ranked **or** «Вне зачёта») | follows exist, none has a season row | viewer's row kept at its true official rank (no duplicate «Ваша позиция») **plus** the note «У ваших подписок пока нет результатов в этом сезоне» below the list |
| D | no result | follows exist, nobody has a row | no rows · «Пока без позиции» · «У ваших подписок пока нет результатов в этом сезоне» |
| E | anonymous | — | no request · no rows · no current-player card · «Вы пока ни на кого не подписаны» |

Case C is detected when, after filtering, no row other than the viewer's own remains (`data-testid="following-no-results"`). If at least one followed player has a ranked or out-of-competition row, no note is shown.

## 13. Tests, baseline and build notes

Relevant suites (all pass on a disposable Postgres 16; the PG-gated ones need `FOLLOW_POSTGRES_TEST_URL` / `PLAYER_MERGE_POSTGRES_TEST_URL` pointing at a localhost DB whose name contains `test`, run with `--no-file-parallelism`, and the self-service merge suite additionally needs dummy `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — an existing requirement):

| Suite | Tests |
|---|---|
| `lib/repositories/follow/__tests__/follow-postgres.integration.test.ts` | 20 |
| `features/__tests__/follows.test.ts` | 41 |
| `features/__tests__/follows-lifecycle.postgres.integration.test.ts` (real merged / deleted / missing target + CSRF on the real stack) | 8 |
| `lib/__tests__/follows-auth.test.ts` | 19 |
| `lib/__tests__/request-origin.test.ts` | 14 |
| follow routes: `follow` 24 + `follow-csrf` 18, `follow-summary` 13, `followers` 7, `following` 7, `following/ids` 5 | 74 |
| `lib/__tests__/follows-client.test.ts` | 56 |
| `lib/__tests__/client-request.test.ts` / `telegram-context.test.ts` | 11 / 11 |
| `app/players/[id]/__tests__/follow-ui.test.tsx` | 38 |
| `components/follows/__tests__/follow-list-modal.test.tsx` | 28 |
| `lib/__tests__/leaderboard-following.test.ts` / `app/__tests__/leaderboard-page-following.test.tsx` | 18 / 40 |
| merge: `player-merge.test.ts` 39, `player-merge.integration.test.ts` 24, `admin-account-merge.postgres.integration.test.ts` 33, `player-merge-shared-rules.test.ts` 5 | 101 |

**Known baseline failures (pre-existing, unrelated, unchanged by this feature):** the full `npm test` reports a stable set of failing files — `table-visual-polish`, `mtt-reference-datasets`, `push-fold-datasets`, `academy-beginner-after-open-progress`, `admin-delete-player` (needs `NEXT_PUBLIC_SUPABASE_URL`), `player-blocking`, `achievement-display`, `club-activity-media-bundle-boundaries`, `telegram`, academy `bundle-boundaries`. Do not fix them as part of this feature.

**Google Fonts / Onest build flakiness:** `npm run build` intermittently fails with a `fonts.googleapis.com` connection error while fetching the Onest font; an unchanged re-run passes. Treat it as a network flake **only** when the error is that exact fetch failure and a later unchanged run succeeds.

## 14. Release

### Verified release order

`.github/workflows/deploy.yml` triggers on **every push to `main`** (and on `workflow_dispatch`); it has no `paths` filter and no commit-message condition of its own, and it **does not run migrations**. `.github/workflows/production-migrations.yml` is `workflow_dispatch` only (input `MIGRATE`, `main` only), builds a migrator image of the dispatched SHA, takes a verified `pg_dump`, applies pending migrations, verifies the tracking chain, and never restarts the app container. Both share the concurrency group `production-deploy`.

GitHub skips push-triggered workflows when the **head commit** message contains `[skip ci]`. Repository evidence: `4bf7ef4 … [skip ci]` (and the earlier `bcd21a0`, `b709fa9`, all migration-bearing) have **no** push-triggered Deploy run in `gh run list`; `4bf7ef4` was instead deployed by a manual `workflow_dispatch` Deploy after migrating, while `15effaa` (no tag) deployed automatically on push.

Invariant: **no deployed app version that queries `follows` may run before `0031` exists.** A merge (`moveFollows`) fails with `relation "follows" does not exist` in that window, even for players who never use the feature.

**Recommended — Option A (the proven repository flow):**
1. One accumulated commit whose message contains `[skip ci]` (it must be the HEAD commit of the push).
2. `git push` → confirm no push-triggered `Deploy` run started (`gh run list --workflow=deploy.yml --limit 3`).
3. Run **Production Migrations** (`confirmation = MIGRATE`) from `main`.
4. Read-only verify: `SELECT to_regclass('public.follows');` returns `follows`.
5. Run **Deploy** manually (`workflow_dispatch`, `main`).
6. Health + web smoke, then the Telegram smoke below.

Option B (split: schema+migration-only commit pushed and auto-deployed first — harmless, nothing queries `follows` — then migrate, then the feature commit) is structurally independent of `[skip ci]` and is the fallback if the tag is ever in doubt (e.g. another push to `main` could arrive meanwhile). Costs one extra deploy.

Rollback: use the deploy's own rollback / redeploy the previous image. **Never drop `follows`** — the migration is additive and the old app ignores the table.

### Checklist

PRE-RELEASE
- [ ] `git fetch`; confirm `origin/main` has no competing `0031` migration (rebase/regenerate only if it does).
- [ ] `npm run lint` · `npx tsc --noEmit` · relevant Follow suites (§13) · `npm run build` (retry once for the Onest flake).
- [ ] Confirm `0030` is already applied in production (the migrate job applies every pending migration, so `0030` would ship too).

DATABASE FIRST
- [ ] Production Migrations workflow succeeded; `public.follows` exists (read-only query above).
- [ ] Do **not** drop `follows` during any rollback.

APP
- [ ] Deploy only after the migration succeeded; `GET /api/health` is `{"ok":true}`; normal web smoke.
- [ ] Follow on **both** `re-raise.ru` and `www.re-raise.ru` (host/Origin check, §9). A 403 here ⇒ check nginx `Host` forwarding and `NEXT_PUBLIC_APP_URL`.

TELEGRAM MANUAL SMOKE — Telegram mobile, Telegram Desktop, Telegram Web (if available). In each: profile loads · counters appear · follow · unfollow · followers list · following list · leaderboard «Подписки». Also smoke the authenticated consumers of the shared `fetchAdminJson` / `getAdminHeaders` path: **Teams**, **Dealer**, and the **Admin** screen(s) the tester can open.

MERGE
- [ ] After deployment, perform one controlled QA/test player merge (with follow edges on both sides) if it can be done safely, and confirm the edges moved.

## 15. Known limitations / not proven

- Behaviour on real Telegram clients is unproven: `isTelegramMiniAppContext()` for the shared `getAdminHeaders`, cookie availability in Telegram Web/Desktop, iOS safe-area and scroll-lock in the WebView.
- Whether `0030` is applied in production; production DB load.
- Real-browser exploitability of the CSRF gap before F1 (derived from cookie settings); the Origin gate relies on proxy host forwarding / `NEXT_PUBLIC_APP_URL` as described in §9.
- Volumes well beyond ~7 k edges.
- No rate limiting (Sterling parity). `following/ids` has no upper bound (fine at club scale).
- Pre-existing issues noticed and **not** touched: initData TTL mismatch (server 1 h vs client cache 24 h) for non-follow routes; `getPlayerById` returns the full `Player` to any caller; `resolveCurrentPlayer()` in Telegram trusts `initDataUnsafe.user` (client id is a UI hint only — follows authorise server-side); `fetchJsonWithRetry` retries 4xx once; several routes echo `error.message`; `/api/club-activity/[id]/like` is cookie-only (same CSRF class as the one fixed here for follows).

## 16. File map (as built)

| Group | Files |
|---|---|
| Schema / migration | `lib/db/schema/follows.ts`, `lib/db/schema/index.ts`, `lib/db/migrations/0031_overjoyed_onslaught.sql`, `meta/0031_snapshot.json`, `meta/_journal.json` |
| Repository | `lib/repositories/follow/*`, `lib/repositories/index.ts` |
| Domain / API | `features/follows.ts`, `lib/uuid.ts`, `lib/follows-auth.ts`, `lib/request-origin.ts`, `lib/follows-error-response.ts`, `app/api/players/[id]/{follow,follow-summary,followers,following,following/ids}/route.ts` |
| Merge | `lib/player-merge.ts` (`moveFollows`) |
| Client | `lib/client-request.ts` (`getAdminHeaders`), `lib/follows-client.ts`, `app/players/[id]/page.tsx`, `components/follows/follow-list-modal.tsx`, `lib/leaderboard-following.ts`, `app/leaderboard/page.tsx` |
| Docs | this file, `docs/architecture.md` (§13 Player Following) |
| Tests | see §13 (+ `lib/__tests__/helpers/follows-fixtures.ts`) |
