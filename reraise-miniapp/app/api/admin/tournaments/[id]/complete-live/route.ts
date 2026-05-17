import { NextResponse } from "next/server";
import { completeTournamentFromLiveEntries } from "@/features/tournaments";
import { syncTournamentLiveSheet } from "@/app/api/admin/tournaments/[id]/live-sync/route";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const result = await completeTournamentFromLiveEntries(id);
    await syncTournamentLiveSheet(id);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to complete live tournament",
      },
      { status: 500 }
    );
  }
}
