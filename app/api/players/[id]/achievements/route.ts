import { NextResponse } from "next/server";
import { achievementRepository } from "@/lib/repositories";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    let data;
    try {
      data = await achievementRepository.findSummariesByPlayerId(id);
    } catch (dbError) {
      console.error("[GET /api/players/[id]/achievements] DB error:", dbError);
      return NextResponse.json(
        { error: dbError instanceof Error ? dbError.message : String(dbError) },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("[GET /api/players/[id]/achievements] Unexpected error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch achievements" },
      { status: 500 }
    );
  }
}
