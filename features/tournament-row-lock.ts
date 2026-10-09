import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tournaments } from "@/lib/db/schema";

// THE one tournament-row lock primitive -- every transaction that decides
// or mutates per-tournament seat/registration/Late-Registration state must
// take this FIRST, before reading or writing anything else for that
// tournament. It is the single serialization point that makes these
// operations mutually exclusive for the SAME tournament:
//
//   - features/tournament-waitlist-capacity.ts: admission/registration
//     capacity decisions, waitlist promotion, return-to-game capacity
//     checks
//   - features/late-registration.ts: closing Late Registration (creating
//     the tournament_late_registration snapshot)
//
// Without a shared lock, closing Late Registration and a waitlist
// promotion decision could each observe a stale "no snapshot yet" read and
// commit in an order that lets a promotion land after the official closing
// boundary. Sharing this exact lock means whichever transaction acquires
// it first runs to completion (promotion or snapshot-insert) before the
// other even reads tournament_late_registration -- so a promotion can
// never straddle the snapshot boundary in either direction.
export type Executor = typeof db;

export async function lockTournamentRow(
  tx: Executor,
  tournamentId: string
): Promise<{ maxPlayers: number } | null> {
  const [row] = await tx
    .select({ id: tournaments.id, maxPlayers: tournaments.maxPlayers })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .for("update");
  return row ? { maxPlayers: row.maxPlayers } : null;
}
