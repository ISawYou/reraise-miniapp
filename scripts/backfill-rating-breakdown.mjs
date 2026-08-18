// Rating Breakdown historical reconstruction tool -- SUPABASE (dev/local)
// variant. DRY RUN ONLY as of this stage.
//
// IMPORTANT: this app's production deployment is VPS + Docker + self-hosted
// PostgreSQL (DATABASE_PROVIDER=postgres) -- Supabase is NOT part of
// production for this app. This script only talks to whatever Supabase
// project NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY point to (e.g.
// a local/dev Supabase project), which will NOT contain real historical
// tournament data. For the real production dry-run, use
// scripts/backfill-rating-breakdown-postgres.mjs (DATABASE_URL) instead --
// see docs/RATING_BREAKDOWN_ANALYSIS.md for the exact, safe VPS invocation.
//
// The actual reconstruction algorithm lives in
// scripts/lib/rating-breakdown-reconstruct.mjs and is shared, unchanged,
// with the Postgres variant -- there is exactly one implementation of the
// business logic, only the data-access layer differs between the two
// scripts.
//
// This script NEVER writes to the database. It is read-only end to end.
// --apply exists only to fail loudly and explain why, in case someone
// assumes this tool can perform the real backfill on its own -- a real
// write path is a deliberate, separate, human-approved next step once a
// report has been reviewed.
//
// Follows the same shape as scripts/backfill-postgres.mjs: a plain
// standalone script using @supabase/supabase-js directly, not the app's
// Repository Layer (Repository files' extension-less relative imports
// don't resolve under plain `node`, only under Next.js's bundler).
//
// Usage:
//   node --env-file-if-exists=.env.local scripts/backfill-rating-breakdown.mjs
//   node --env-file-if-exists=.env.local scripts/backfill-rating-breakdown.mjs --all
//   npm run backfill:rating-breakdown -- --all
//
// --all: also re-check rows that already have participation_points set
//   (default: only rows still NULL there, i.e. not yet backfilled).
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
// environment (.env.local is picked up automatically via --env-file-if-exists,
// same as every other db:*/backfill:* script in package.json).

import { createClient } from "@supabase/supabase-js";
import { reconstructRow, summarize, printReport } from "./lib/rating-breakdown-reconstruct.mjs";

const PAGE_SIZE = 500;

async function fetchAllResults(supabase, { all }) {
  const rows = [];
  let from = 0;

  for (;;) {
    let query = supabase
      .from("results")
      .select(
        [
          "id",
          "tournament_id",
          "player_id",
          "place",
          "knockouts",
          "boss_knockouts",
          "mystery_bounty_points",
          "rating_points",
          "participation_points",
          "knockout_points",
          "boss_bounty_points",
          "itm_points",
          "tournament:tournaments (tournament_type, rating_formula_version)",
        ].join(", ")
      )
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (!all) {
      query = query.is("participation_points", null);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to read results (offset ${from}): ${error.message}`);
    }

    rows.push(...(data ?? []));

    if (!data || data.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");

  if (args.includes("--apply")) {
    console.error(
      [
        "--apply is not implemented at this stage.",
        "",
        "This tool is dry-run only until a human reviews the report below",
        "against real production data. Writing the reconstructed values back",
        "is a deliberate, separate step -- not something this script does on",
        "its own. Re-run without --apply.",
      ].join("\n")
    );
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment.\n" +
        "Run via: node --env-file-if-exists=.env.local scripts/backfill-rating-breakdown.mjs"
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  console.log("Rating Breakdown reconstruction -- SUPABASE DRY RUN (no writes are made)");
  console.log(
    "NOTE: production for this app is VPS/Postgres, not Supabase -- this only\n" +
      "checks whatever Supabase project the environment points to.\n"
  );
  console.log(all ? "Scope: ALL results rows\n" : "Scope: results rows with participation_points still NULL\n");

  const { count: totalTournaments, error: countError } = await supabase
    .from("tournaments")
    .select("*", { count: "exact", head: true });
  if (countError) {
    throw new Error(`Failed to count tournaments: ${countError.message}`);
  }

  const rows = await fetchAllResults(supabase, { all });
  const results = rows.map(reconstructRow);
  const report = summarize(rows, results, totalTournaments ?? 0);
  printReport(report);
}

main().catch((err) => {
  console.error("Rating Breakdown dry run failed:", err);
  process.exit(1);
});
