# Club discounts (2026-09-27)

Two club members have a permanent 10% discount on paid tournament
participation. GainUp (bar) already applies its own discount for them —
RERAISE/Finance never touch that. This document covers only the
RERAISE-side discount on tournament Entry/Re-entry/Add-on, and the export
contract that lets the separate RERAISE Finance app compute the resulting
contra-revenue.

**Production note:** this app's production database is self-hosted
Postgres (`DATABASE_PROVIDER=postgres`) — Supabase is fully retired in
production (see `docs/RATING_BREAKDOWN_ANALYSIS.md`'s architecture note).
The Supabase repository implementations below exist for local-dev/test
parity only; the frozen-discount mechanism is deliberately Postgres-only
(see "Storage" below) since it has no production relevance on Supabase.

## Product rule

A club discount is a reduction of actual revenue, not an expense. Base
price × (1 − discount%) = actual charge. Finance (not RERAISE) is where
this becomes a P&L line — RERAISE only ever produces the FACTS (who, how
many paid units, what percent); RERAISE has no tournament pricing at all
(that lives entirely in Finance's `finance_tournament_pricing`), so it
was never possible for RERAISE to compute a RUB amount itself.

## Stable identity

`players.id` (uuid) — never a nickname/username/display name, all of
which are user-editable and already known to change (`admin_display_name`,
`pending_display_name`, nickname moderation). Every discount field below
is keyed by this id. Account merges (`players.merged_into_player_id`)
are out of scope for this feature exactly as they are everywhere else in
the codebase today — no new merge-aware lookup was added here beyond
what already exists.

## Data model

### `players.club_discount_percent` (LIVE setting)

Integer, `0-100`, `NOT NULL DEFAULT 0`, `CHECK` constrained. Migration
`lib/db/migrations/0026_chemical_chimera.sql` (Postgres). Supabase parity
patch: `sql/players_club_discount_percent.sql` (manual, same convention as
`sql/players_is_blocked.sql`).

This is the CURRENT, editable setting — a Super Admin changes it in the
player catalog (`app/admin/moderation/page.tsx`, "Скидка клуба" control,
`PATCH /api/admin/players/[id]` with `{action: "setClubDiscount",
clubDiscountPercent}` → `features/admin.ts`'s `setPlayerClubDiscount`).
It is **never** read back for a tournament that already has results —
see the freeze rule below.

### `results.club_discount_percent` (FROZEN fact)

Integer, `0-100`, `NOT NULL DEFAULT 0`, `CHECK` constrained. Migration
`0026_chemical_chimera.sql` (Postgres only — see "Storage" below).

This is the percent **actually applied** to this player's paid
participation in **this** tournament — a frozen historical fact, exactly
like every other column on `results` (`rating_points`,
`participation_points`, etc.). 0 for every pre-existing row: no discount
concept existed before this column, so 0 is the true historical fact for
those rows, not a guess.

## Freeze point

The exact moment a result row is (re-)written for a player in a
tournament — `features/tournaments.ts`'s two completion paths:

- `completeTournamentFromLiveEntries` (live/cash tournaments)
- `saveTournamentResults` (free/Google-Sheets-completed tournaments — also
  the path an admin correction re-runs; both already do a full
  delete-then-reinsert of `results` for the tournament, the existing
  "edit semantics" this feature reuses rather than inventing a second
  workflow)

Both paths call a new shared helper, `resolveClubDiscountPercents`,
**before** their existing `resultRepository.deleteByTournamentId` call
(reading the about-to-be-deleted rows first is the only way to preserve
them):

```
for each player about to be (re)written:
  if a results row ALREADY exists for this player+tournament:
    reuse its existing club_discount_percent unchanged
  else (first time this player is resulted for this tournament):
    freeze their CURRENT players.club_discount_percent
```

**Why this is correct across a correction.** An admin correction (fixing
a knockout count, a misplaced result, etc.) re-runs the exact same
delete-then-reinsert. Without this rule, that correction would silently
re-read whatever the player's *live* discount happens to be *at
correction time* — which could differ from what it was at the original
completion, retroactively changing a past tournament's numbers purely as
a side effect of an unrelated correction. Carrying the already-frozen
value forward makes that provably impossible: a player's discount
setting can only ever affect a tournament the FIRST time that player is
resulted for it. Covered by
`features/__tests__/tournament-results-completion.test.ts`'s "CLUB
DISCOUNTS" describe block (first completion freezes live value;
correction preserves the old value even though the live value changed;
correction still live-freezes a genuinely new player; both completion
paths behave identically; repeat/idempotent runs never drift).

## Free re-entries interaction

`results.free_reentries` (an existing, separate field — see
`features/finance-export.ts`) is never discounted a second time: the
export's per-player breakdown (below) reports `paidReentryCount` already
net of `free_reentries`, clamped at 0. A player's very first entry has no
"free" concept anywhere in this data model (only re-entries can be free),
so it is always included at full count (`entryCount: 1`) and simply gets
the discount percent applied like any other paid unit — never a special
case, since it is never zero to begin with.

## Export contract (`features/finance-export.ts`)

`FinanceTournamentExportRow` gained one new, additive field:

```ts
playerDiscounts: Array<{
  playerId: string;
  entryCount: number;        // always 1
  paidReentryCount: number;  // normalized reentries, minus free_reentries, floor 0
  paidAddonCount: number;    // addons have no free concept
  discountPercent: number;   // this player's FROZEN percent, 1-100 (0% never appears)
}>
```

Built by the pure function `buildPlayerDiscounts` (exported, directly
unit-tested in `features/__tests__/club-discount.test.ts`) over the SAME
`attendanceRows` the existing tournament-wide aggregate already reads —
no second query. Only arrived players with a non-zero frozen percent are
included; everyone else is implicitly "no discount" by absence, keeping
the payload small (the overwhelming majority of players have 0%). Every
existing aggregate field (`entryCount`, `reentryCount`, `addonCount`,
`freeReentryCount`, ...) is completely unchanged — this is purely
additive, backwards compatible with any Finance instance that hasn't
been updated to read the new field yet.

Finance is expected to compute, per tournament: for each entry in
`playerDiscounts`, the gross value of that player's own paid units at
Finance's own configured per-unit prices, times `discountPercent/100`,
summed — then subtract that from the tournament-wide gross game revenue
it already computes. RERAISE never computes a RUB amount itself (it has
no pricing data at all).

## GainUp (bar) — out of scope for this feature by design

GainUp already has its own 10% discount configured and applied for these
same two players' bar purchases. RERAISE/Finance never write to GainUp,
never re-derive or duplicate that discount, and never subtract anything
from GainUp's own final line amounts — those already reflect GainUp's
discount. See the separate RERAISE Finance repository's own
`GAINUP_DISCOUNT_AUDIT.md`/`PNL_SOURCE_MODEL.md` notes for the audit of
what GainUp's API actually exposes about it.

## What was deliberately NOT built

- No separate discount CRM/history table — the LIVE setting is a single
  column, same shape as every other player preference in this schema
  (`can_access_paid`, `is_blocked`, etc.).
- No parallel payment/pricing workflow in RERAISE — RERAISE has never had
  tournament pricing and this feature does not introduce it; pricing and
  the resulting RUB P&L impact live entirely in Finance.
- No specific player IDs were populated by this change. Setting the two
  known club members to 10% is a separate, explicit follow-up action for
  whoever operates the admin UI — this implementation deliberately never
  hardcodes any player identity.
