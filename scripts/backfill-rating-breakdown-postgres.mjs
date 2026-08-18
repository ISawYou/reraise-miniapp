// Rating Breakdown historical reconstruction -- PRODUCTION (Postgres)
// variant. Supports a read-only dry run (default) and a write-mode
// historical backfill (--apply).
//
// Why this file exists, separate from backfill-rating-breakdown.mjs: this
// app's production deployment is VPS + Docker + self-hosted PostgreSQL
// (DATABASE_PROVIDER=postgres) -- Supabase is not part of production for
// this app anymore. This script talks to the real production database
// directly via drizzle-orm/postgres-js + DATABASE_URL, the same connection
// method lib/db/client.ts uses at runtime.
//
// The actual reconstruction algorithm lives in
// scripts/lib/rating-breakdown-reconstruct.mjs and is shared, UNCHANGED,
// between the dry run and --apply -- there is exactly one implementation of
// the business logic; --apply does not recompute with different code, it
// writes the same values the dry run would have reported. See
// docs/RATING_BREAKDOWN_ANALYSIS.md for the full derivation and the actual
// production dry-run results this script's EXPECTED_BASELINE below was
// taken from.
//
// --apply safety model (see docs/RATING_BREAKDOWN_ANALYSIS.md section 6 for
// the full writeup):
//   1. Preflight: a full, read-only reconstruction of EVERY results row
//      (regardless of --all), using the exact same reconstructRow() as the
//      dry run. Its aggregate shape (total rows / total tournaments /
//      legacy rows / v2 rows / failed count) is compared against
//      EXPECTED_BASELINE, the last confirmed clean dry-run. Any mismatch --
//      including simply "more tournaments were completed since the last
//      dry run" -- aborts with zero writes. This is intentionally strict:
//      re-run the plain dry run to get a fresh baseline and re-approve
//      before retrying --apply, rather than silently proceeding against a
//      dataset that has moved since the last human review.
//   2. If preflight is clean and matches the baseline: ONE database
//      transaction. Only `arrived`, `participation_points`,
//      `knockout_points`, `boss_bounty_points`, `itm_points` are written --
//      never `rating_points`, never `mystery_bounty_points` (already
//      correct, read as-is), never any other column.
//   3. Inside the same transaction, after the UPDATEs but before COMMIT:
//      post-write validation queried directly from the database (not from
//      in-memory values) -- NULL breakdown count, the sum invariant,
//      negative components, arrived/itm sanity counts, and a per-formula-
//      version breakdown. Any failure throws, which rolls the whole
//      transaction back -- no partially-written production dataset.
//   4. Idempotent: writes are deterministic functions of already-frozen
//      columns (rating_points, knockouts, boss_knockouts,
//      mystery_bounty_points, tournament_type/rating_formula_version), not
//      increments. Default scope is rows where participation_points IS
//      NULL, so a second run against an already-backfilled dataset updates
//      zero rows. --all re-writes every row with the same values.
//
// Usage (see docs/RATING_BREAKDOWN_ANALYSIS.md for the exact, safe VPS
// invocation):
//   DATABASE_URL=postgres://... node scripts/backfill-rating-breakdown-postgres.mjs
//   DATABASE_URL=postgres://... node scripts/backfill-rating-breakdown-postgres.mjs --all
//   DATABASE_URL=postgres://... node scripts/backfill-rating-breakdown-postgres.mjs --apply
//   DATABASE_URL=postgres://... node scripts/backfill-rating-breakdown-postgres.mjs --apply --all
//
// --all: without --apply, also re-check rows that already have
//   participation_points set (default: only NULL rows). With --apply,
//   also re-write rows that already have participation_points set
//   (default: only backfill rows still NULL there).

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { pgTable, uuid, text, integer, boolean } from "drizzle-orm/pg-core";
import { isNull, eq, sql } from "drizzle-orm";
import { reconstructRow, summarize, printReport } from "./lib/rating-breakdown-reconstruct.mjs";

// Only the columns this script reads/writes -- deliberately not the full
// schema (matches backfill-postgres.mjs's established redeclaration
// pattern; plain `node` can't resolve lib/db/schema's extension-less
// relative imports the way Next.js's bundler does).
const resultsTable = pgTable("results", {
  id: uuid().primaryKey(),
  tournamentId: uuid("tournament_id").notNull(),
  playerId: uuid("player_id").notNull(),
  knockouts: integer().notNull(),
  bossKnockouts: integer("boss_knockouts").notNull(),
  mysteryBountyPoints: integer("mystery_bounty_points").notNull(),
  ratingPoints: integer("rating_points").notNull(),
  arrived: boolean(),
  participationPoints: integer("participation_points"),
  knockoutPoints: integer("knockout_points"),
  bossBountyPoints: integer("boss_bounty_points"),
  itmPoints: integer("itm_points"),
});

const tournamentsTable = pgTable("tournaments", {
  id: uuid().primaryKey(),
  tournamentType: text("tournament_type").notNull(),
  ratingFormulaVersion: text("rating_formula_version").notNull(),
});

// Last confirmed clean production dry run (see
// docs/RATING_BREAKDOWN_ANALYSIS.md section 6). --apply's preflight must
// match this exactly, or it aborts -- see the safety model note above for
// why this is intentionally strict rather than best-effort.
const EXPECTED_BASELINE = {
  totalRows: 594,
  totalTournaments: 42,
  legacyRows: 516,
  v2Rows: 78,
  failed: 0,
};

async function fetchRows(db, { onlyNull }) {
  let query = db
    .select({
      id: resultsTable.id,
      tournament_id: resultsTable.tournamentId,
      player_id: resultsTable.playerId,
      knockouts: resultsTable.knockouts,
      boss_knockouts: resultsTable.bossKnockouts,
      mystery_bounty_points: resultsTable.mysteryBountyPoints,
      rating_points: resultsTable.ratingPoints,
      current_participation_points: resultsTable.participationPoints,
      tournament_type: tournamentsTable.tournamentType,
      rating_formula_version: tournamentsTable.ratingFormulaVersion,
    })
    .from(resultsTable)
    .leftJoin(tournamentsTable, eq(resultsTable.tournamentId, tournamentsTable.id))
    .orderBy(resultsTable.id);

  if (onlyNull) {
    query = query.where(isNull(resultsTable.participationPoints));
  }

  const rawRows = await query;

  return rawRows.map((r) => ({
    id: r.id,
    tournament_id: r.tournament_id,
    player_id: r.player_id,
    knockouts: r.knockouts,
    boss_knockouts: r.boss_knockouts,
    mystery_bounty_points: r.mystery_bounty_points,
    rating_points: r.rating_points,
    current_participation_points: r.current_participation_points,
    tournament:
      r.tournament_type != null
        ? { tournament_type: r.tournament_type, rating_formula_version: r.rating_formula_version }
        : null,
  }));
}

// Always the FULL table, regardless of --all -- --all only ever controls
// the scope of what dry-run re-checks or --apply re-writes, never what
// preflight validates.
async function runPreflight(db) {
  const [{ count: totalTournaments }] = await db
    .select({ count: sql`count(*)`.mapWith(Number) })
    .from(tournamentsTable);

  const rows = await fetchRows(db, { onlyNull: false });
  const results = rows.map(reconstructRow);
  const report = summarize(rows, results, totalTournaments);

  return { rows, results, report };
}

function baselineMismatch(summary) {
  const mismatches = [];
  for (const key of ["totalRows", "totalTournaments", "legacyRows", "v2Rows", "failed"]) {
    if (summary[key] !== EXPECTED_BASELINE[key]) {
      mismatches.push(`${key}: expected ${EXPECTED_BASELINE[key]}, got ${summary[key]}`);
    }
  }
  return mismatches;
}

async function postWriteValidate(tx) {
  const [overall] = await tx.execute(sql`
    SELECT
      count(*) FILTER (
        WHERE arrived IS NULL OR participation_points IS NULL OR knockout_points IS NULL
           OR boss_bounty_points IS NULL OR itm_points IS NULL
      )::int AS null_breakdown_count,
      count(*) FILTER (
        WHERE rating_points IS DISTINCT FROM (
          participation_points + knockout_points + boss_bounty_points + mystery_bounty_points + itm_points
        )
      )::int AS sum_violations,
      count(*) FILTER (
        WHERE participation_points < 0 OR knockout_points < 0 OR boss_bounty_points < 0
           OR mystery_bounty_points < 0 OR itm_points < 0
      )::int AS negative_components,
      count(*)::int AS total_rows,
      count(*) FILTER (WHERE arrived = true)::int AS arrived_true,
      count(*) FILTER (WHERE arrived = false)::int AS arrived_false,
      count(*) FILTER (WHERE itm_points > 0)::int AS itm_positive,
      count(*) FILTER (WHERE itm_points = 0)::int AS itm_zero
    FROM results
  `);

  const byFormulaVersion = await tx.execute(sql`
    SELECT
      t.rating_formula_version AS formula_version,
      count(*)::int AS total_rows,
      count(*) FILTER (
        WHERE r.arrived IS NULL OR r.participation_points IS NULL OR r.knockout_points IS NULL
           OR r.boss_bounty_points IS NULL OR r.itm_points IS NULL
      )::int AS null_breakdown_count,
      count(*) FILTER (
        WHERE r.rating_points IS DISTINCT FROM (
          r.participation_points + r.knockout_points + r.boss_bounty_points + r.mystery_bounty_points + r.itm_points
        )
      )::int AS sum_violations
    FROM results r
    JOIN tournaments t ON t.id = r.tournament_id
    GROUP BY t.rating_formula_version
    ORDER BY t.rating_formula_version
  `);

  const samples = await tx.execute(sql`
    SELECT DISTINCT ON (t.tournament_type)
      r.id AS result_id,
      r.tournament_id,
      t.tournament_type,
      t.rating_formula_version,
      r.rating_points,
      r.participation_points,
      r.knockout_points,
      r.boss_bounty_points,
      r.mystery_bounty_points,
      r.itm_points,
      (r.participation_points + r.knockout_points + r.boss_bounty_points + r.mystery_bounty_points + r.itm_points)
        AS reconstructed_sum
    FROM results r
    JOIN tournaments t ON t.id = r.tournament_id
    ORDER BY
      t.tournament_type,
      (r.knockout_points > 0 OR r.boss_bounty_points > 0 OR r.mystery_bounty_points > 0) DESC,
      r.id
  `);

  return { overall, byFormulaVersion, samples };
}

function printApplyReport({ updatedCount, postCheck }) {
  console.log("\n=== Post-write validation (checked before COMMIT) ===");
  console.log(`rows updated this run:        ${updatedCount}`);
  console.log(`total results rows in DB:     ${postCheck.overall.total_rows}`);
  console.log(`NULL breakdown remaining:     ${postCheck.overall.null_breakdown_count}`);
  console.log(`sum invariant violations:     ${postCheck.overall.sum_violations}`);
  console.log(`negative components:          ${postCheck.overall.negative_components}`);
  console.log(`arrived = true:               ${postCheck.overall.arrived_true}`);
  console.log(`arrived = false:              ${postCheck.overall.arrived_false}`);
  console.log(`itm_points > 0:               ${postCheck.overall.itm_positive}`);
  console.log(`itm_points = 0:               ${postCheck.overall.itm_zero}`);

  console.log("\n--- By formula version ---");
  for (const row of postCheck.byFormulaVersion) {
    console.log(
      `${row.formula_version}: total=${row.total_rows} null_breakdown=${row.null_breakdown_count} sum_violations=${row.sum_violations}`
    );
  }

  console.log("\n--- Sample rows (one per tournament_type present) ---");
  for (const row of postCheck.samples) {
    console.log(JSON.stringify(row, null, 2));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const apply = args.includes("--apply");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "Missing DATABASE_URL in the environment.\n" +
        "Run via: DATABASE_URL=postgres://... node scripts/backfill-rating-breakdown-postgres.mjs"
    );
    process.exit(1);
  }

  const client = postgres(connectionString);
  const db = drizzle(client);

  try {
    if (!apply) {
      console.log("Rating Breakdown reconstruction -- PRODUCTION Postgres DRY RUN (no writes are made)");
      console.log(all ? "Scope: ALL results rows\n" : "Scope: results rows with participation_points still NULL\n");

      const [{ count: totalTournaments }] = await db
        .select({ count: sql`count(*)`.mapWith(Number) })
        .from(tournamentsTable);
      const rows = await fetchRows(db, { onlyNull: !all });
      const results = rows.map(reconstructRow);
      const report = summarize(rows, results, totalTournaments);
      printReport(report);
      return;
    }

    // --apply -----------------------------------------------------------
    console.log("Rating Breakdown historical backfill -- PRODUCTION Postgres WRITE MODE");
    console.log("Step 1/3: preflight (full read-only reconstruction of every results row)\n");

    const preflight = await runPreflight(db);
    printReport(preflight.report);

    const mismatches = baselineMismatch(preflight.report.summary);
    if (preflight.report.summary.failed > 0 || mismatches.length > 0) {
      console.error("\n=== ABORT: preflight did not match the last confirmed clean dry run ===");
      if (preflight.report.summary.failed > 0) {
        console.error(`${preflight.report.summary.failed} row(s) failed reconstruction -- see failures above.`);
      }
      for (const m of mismatches) {
        console.error(`baseline mismatch -- ${m}`);
      }
      console.error(
        "\nNo UPDATE was executed. This can simply mean new tournaments were" +
          " completed since the last approved dry run -- re-run this script" +
          " without --apply, review the fresh report, update EXPECTED_BASELINE" +
          " in this file to match, and re-run --apply only after that review."
      );
      process.exit(1);
    }

    console.log("\nPreflight matches the last confirmed clean dry run exactly. Proceeding.\n");
    console.log(`Step 2/3: writing inside a single transaction (scope: ${all ? "ALL rows" : "participation_points IS NULL"})\n`);

    const targetRows = all
      ? preflight.rows
      : preflight.rows.filter((r) => r.current_participation_points == null);
    const reconstructedById = new Map(preflight.rows.map((r, i) => [r.id, preflight.results[i]]));

    let updatedCount = 0;
    let postCheck = null;

    await db.transaction(async (tx) => {
      for (const row of targetRows) {
        const reconstructed = reconstructedById.get(row.id);
        await tx
          .update(resultsTable)
          .set({
            arrived: reconstructed.arrived,
            participationPoints: reconstructed.participation_points,
            knockoutPoints: reconstructed.knockout_points,
            bossBountyPoints: reconstructed.boss_bounty_points,
            itmPoints: reconstructed.itm_points,
            // Deliberately NOT set: ratingPoints, mysteryBountyPoints, or
            // any other column -- see the safety model note at the top of
            // this file.
          })
          .where(eq(resultsTable.id, row.id));
        updatedCount += 1;
      }

      console.log(`Step 3/3: post-write validation (before COMMIT) -- ${updatedCount} row(s) written this run\n`);
      postCheck = await postWriteValidate(tx);

      const hasProblem =
        postCheck.overall.null_breakdown_count > 0 ||
        postCheck.overall.sum_violations > 0 ||
        postCheck.overall.negative_components > 0 ||
        postCheck.byFormulaVersion.some((r) => r.null_breakdown_count > 0 || r.sum_violations > 0);

      if (hasProblem) {
        printApplyReport({ updatedCount, postCheck });
        throw new Error(
          "Post-write validation failed -- rolling back the entire transaction. No production data was changed."
        );
      }
    });

    console.log("Post-write validation passed. Transaction COMMITTED.\n");
    printApplyReport({ updatedCount, postCheck });
  } catch (err) {
    if (apply) {
      console.error(
        "\n=== ROLLBACK: the transaction was rolled back, no production data was changed ===\n" + err.message
      );
      process.exit(1);
    }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Rating Breakdown production script failed:", err);
  process.exit(1);
});
