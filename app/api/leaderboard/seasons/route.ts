import { NextResponse } from "next/server";
import { listSeasonsPublic } from "@/features/seasons";

// Public season list -- for an archive-season picker. Player-safe shape
// only: id/title/isActive, never start_date/end_date (see
// features/seasons.ts::PublicSeason and listSeasonsPublic).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const seasons = await listSeasonsPublic();
    return NextResponse.json({ seasons });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
