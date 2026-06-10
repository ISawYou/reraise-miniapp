import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const db = getSupabaseServer();

    const { data, error } = await db
      .from("player_achievements")
      .select("achievement_code, current_value, completed_at")
      .eq("player_id", id);

    if (error) {
      console.error("[GET /api/players/[id]/achievements] DB error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error("[GET /api/players/[id]/achievements] Unexpected error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch achievements" },
      { status: 500 }
    );
  }
}
