import { type NextRequest, NextResponse } from "next/server";
import { logActivityEvent } from "@/lib/activity-logger";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const { player_id, event_type, event_label, metadata, platform, session_id } = body;

    if (!player_id || typeof player_id !== "string") return NextResponse.json({ ok: true });
    if (!event_type || typeof event_type !== "string") return NextResponse.json({ ok: true });

    const db = getSupabaseServer();
    const { data: player } = await db
      .from("players")
      .select("id, role")
      .eq("id", player_id)
      .maybeSingle();

    if (!player) return NextResponse.json({ ok: true });

    await logActivityEvent({
      player_id,
      event_type,
      event_label: typeof event_label === "string" ? event_label : undefined,
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : undefined,
      platform: typeof platform === "string" ? platform : "unknown",
      session_id: typeof session_id === "string" ? session_id : undefined,
      is_admin: player.role === "admin",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/activity] error:", err);
    return NextResponse.json({ ok: true });
  }
}
