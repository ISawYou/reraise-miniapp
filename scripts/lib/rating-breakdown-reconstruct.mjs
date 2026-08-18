// Shared, backend-agnostic core of the Rating Breakdown historical
// reconstruction. Used by BOTH scripts/backfill-rating-breakdown.mjs
// (Supabase, local/dev data only) and
// scripts/backfill-rating-breakdown-postgres.mjs (Postgres, the real
// production database as of the VPS/Docker/Postgres cutover -- Supabase is
// no longer part of production for this app).
//
// This file exists specifically so there is only ONE implementation of the
// reconstruction algorithm, not two independently maintained copies that
// could silently drift apart between the dev tool and the production tool --
// the same "single calculator" principle applied to Rating Engine v2 itself
// (features/rating.ts / features/rating-v2.ts), applied here to tooling.
//
// See docs/RATING_BREAKDOWN_ANALYSIS.md for the full derivation and proof of
// everything this module implements -- read alongside that document, not as
// a standalone spec.
//
// Input shape (identical regardless of source database):
//   {
//     id, tournament_id, player_id,
//     knockouts, boss_knockouts, mystery_bounty_points, rating_points,
//     tournament: { tournament_type, rating_formula_version } | null,
//   }

export const KNOCKOUT_FORMATS = new Set(["bounty", "boss_bounty"]);
export const BOSS_KNOCKOUT_FORMATS = new Set(["boss_bounty"]);
export const KNOWN_FORMULA_VERSIONS = new Set(["legacy", "v2"]);

// Mirrors tournaments_tournament_type_check in lib/db/schema/tournaments.ts
// exactly -- kept here (not imported) for the same reason
// backfill-postgres.mjs redeclares its own tables: plain `node` can't
// resolve the app's extension-less relative imports.
export const KNOWN_TOURNAMENT_TYPES = new Set([
  "classic",
  "phoenix",
  "deep_stack",
  "bounty",
  "boss_bounty",
  "win_the_button",
  "mystery_bounty",
]);

export function reconstructRow(row) {
  const issues = [];
  const tournamentType = row.tournament?.tournament_type ?? null;
  const formulaVersion = row.tournament?.rating_formula_version ?? null;

  if (tournamentType == null || formulaVersion == null) {
    issues.push("missing owning tournament (tournament_type/rating_formula_version unavailable)");
  } else {
    if (!KNOWN_TOURNAMENT_TYPES.has(tournamentType)) {
      issues.push(`unknown tournament_type "${tournamentType}"`);
    }
    if (!KNOWN_FORMULA_VERSIONS.has(formulaVersion)) {
      issues.push(`unknown rating_formula_version "${formulaVersion}"`);
    }
  }

  const ratingPoints = row.rating_points ?? 0;

  // Proven invariant (see docs/RATING_BREAKDOWN_ANALYSIS.md section 6) --
  // not a guess. Re-derived, not reused, from raw stored data only.
  const arrived = ratingPoints > 0;

  const hasKnockouts = tournamentType != null && KNOCKOUT_FORMATS.has(tournamentType);
  const hasBossKnockouts = tournamentType != null && BOSS_KNOCKOUT_FORMATS.has(tournamentType);

  const participationPoints = arrived ? 2 : 0;
  const knockoutPoints = arrived && hasKnockouts ? (row.knockouts ?? 0) * 5 : 0;
  const bossBountyPoints = arrived && hasBossKnockouts ? (row.boss_knockouts ?? 0) * 10 : 0;
  const mysteryBountyPoints = arrived ? row.mystery_bounty_points ?? 0 : 0;

  // Residual. For legacy this is provably exact. For v2 Phoenix rows where
  // the Rating Guarantee triggered, this residual also includes the
  // Guarantee top-up folded in -- which is CORRECT per the fixed product
  // decision (no separate phoenix_guarantee_points column or field), not
  // an approximation or a bug.
  const itmPoints = arrived
    ? ratingPoints - participationPoints - knockoutPoints - bossBountyPoints - mysteryBountyPoints
    : 0;

  if (knockoutPoints < 0) issues.push("negative knockout_points");
  if (bossBountyPoints < 0) issues.push("negative boss_bounty_points");
  if (mysteryBountyPoints < 0) issues.push("negative mystery_bounty_points");
  if (itmPoints < 0) issues.push("negative itm_points");

  const sum = participationPoints + knockoutPoints + bossBountyPoints + mysteryBountyPoints + itmPoints;
  if (sum !== ratingPoints) {
    issues.push(`sum mismatch: reconstructed ${sum} !== stored rating_points ${ratingPoints}`);
  }

  return {
    arrived,
    participation_points: participationPoints,
    knockout_points: knockoutPoints,
    boss_bounty_points: bossBountyPoints,
    mystery_bounty_points: mysteryBountyPoints,
    itm_points: itmPoints,
    tournament_type: tournamentType,
    rating_formula_version: formulaVersion,
    ok: issues.length === 0,
    issues,
  };
}

// Aggregates reconstructRow() results into the report shape both CLI
// scripts print. `totalTournaments` is passed in separately (a plain
// `SELECT count(*) FROM tournaments`) since it isn't derivable from the
// results rows alone -- a tournament with zero results (e.g. cancelled
// before completion) wouldn't otherwise be counted.
export function summarize(rows, results, totalTournaments) {
  const summary = {
    totalRows: rows.length,
    totalTournaments,
    legacyRows: 0,
    v2Rows: 0,
    reconstructed: 0,
    failed: 0,
    mismatchedTotals: 0,
    negativeComponents: 0,
    unknownTournamentTypes: 0,
    unknownFormulaVersions: 0,
    missingTournament: 0,
  };

  const failures = [];

  rows.forEach((row, i) => {
    const result = results[i];

    if (result.rating_formula_version === "legacy") summary.legacyRows += 1;
    if (result.rating_formula_version === "v2") summary.v2Rows += 1;

    if (result.ok) {
      summary.reconstructed += 1;
      return;
    }

    summary.failed += 1;
    if (result.issues.some((i) => i.startsWith("sum mismatch"))) summary.mismatchedTotals += 1;
    if (result.issues.some((i) => i.startsWith("negative"))) summary.negativeComponents += 1;
    if (result.issues.some((i) => i.startsWith("unknown tournament_type"))) {
      summary.unknownTournamentTypes += 1;
    }
    if (result.issues.some((i) => i.startsWith("unknown rating_formula_version"))) {
      summary.unknownFormulaVersions += 1;
    }
    if (result.issues.some((i) => i.startsWith("missing owning tournament"))) {
      summary.missingTournament += 1;
    }

    failures.push({
      result_id: row.id,
      tournament_id: row.tournament_id,
      player_id: row.player_id,
      rating_formula_version: result.rating_formula_version,
      tournament_type: result.tournament_type,
      existing_rating_points: row.rating_points,
      reconstructed: {
        arrived: result.arrived,
        participation_points: result.participation_points,
        knockout_points: result.knockout_points,
        boss_bounty_points: result.boss_bounty_points,
        mystery_bounty_points: result.mystery_bounty_points,
        itm_points: result.itm_points,
      },
      issues: result.issues,
    });
  });

  return { summary, failures };
}

export function printReport({ summary, failures }) {
  console.log("=== Summary ===");
  console.log(`total results rows checked:  ${summary.totalRows}`);
  console.log(`total tournaments:            ${summary.totalTournaments}`);
  console.log(`legacy formula rows:          ${summary.legacyRows}`);
  console.log(`v2 formula rows:              ${summary.v2Rows}`);
  console.log(`successfully reconstructed:   ${summary.reconstructed}`);
  console.log(`failed / needs manual review: ${summary.failed}`);
  console.log(`  - mismatched totals:        ${summary.mismatchedTotals}`);
  console.log(`  - negative component(s):    ${summary.negativeComponents}`);
  console.log(`  - unknown tournament_type:  ${summary.unknownTournamentTypes}`);
  console.log(`  - unknown formula version:  ${summary.unknownFormulaVersions}`);
  console.log(`  - missing tournament:       ${summary.missingTournament}`);

  if (failures.length > 0) {
    console.log("\n=== Failed rows (NOT written -- for manual review) ===");
    for (const failure of failures) {
      console.log(JSON.stringify(failure, null, 2));
    }
  }

  console.log(
    failures.length === 0
      ? "\nNo anomalies found. Every checked row's rating_points can be exactly decomposed into the five components."
      : `\n${failures.length} row(s) need manual review before any real backfill -- see above.`
  );

  console.log(
    "\nThis was a dry run: nothing was written to the database. A real write" +
      " path should only be built after this report has been reviewed."
  );
}
