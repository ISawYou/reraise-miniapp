import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

// Admin-only — middleware already verified initData + admin role

export async function GET(request: NextRequest) {
  try {
    const db = getSupabaseServer();
    const url = new URL(request.url);
    const playerId = url.searchParams.get("player_id");

    // User history mode
    if (playerId) {
      const { data: events } = await db
        .from("activity_events")
        .select("event_type, event_label, metadata, platform, session_id, created_at")
        .eq("player_id", playerId)
        .order("created_at", { ascending: false })
        .limit(50);

      return NextResponse.json({ events: events ?? [] });
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartIso = todayStart.toISOString();

    const { data: events7d } = await db
      .from("activity_events")
      .select("player_id, event_type, created_at")
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(10000);

    const events = events7d ?? [];

    const activeTodaySet = new Set<string>();
    const active7dSet = new Set<string>();

    type PlayerStats = { last_seen: string; last_event_type: string; count: number };
    const playerEventMap = new Map<string, PlayerStats>();

    for (const event of events) {
      if (event.created_at >= todayStartIso) activeTodaySet.add(event.player_id);
      active7dSet.add(event.player_id);

      if (!playerEventMap.has(event.player_id)) {
        playerEventMap.set(event.player_id, {
          last_seen: event.created_at,
          last_event_type: event.event_type,
          count: 1,
        });
      } else {
        playerEventMap.get(event.player_id)!.count++;
      }
    }

    // Fetch player details (including role so KPIs can exclude admins)
    const playerIds = [...active7dSet];
    const { data: players } = playerIds.length
      ? await db
          .from("players")
          .select("id, display_name, username, email, role")
          .in("id", playerIds.slice(0, 500))
      : { data: [] };

    const playerMap = new Map((players ?? []).map((p) => [p.id, p]));
    const adminIds = new Set(
      (players ?? []).filter((p) => p.role === "admin").map((p) => p.id)
    );

    // KPIs always exclude admins regardless of include_admin_activity setting
    const active_today = [...activeTodaySet].filter((id) => !adminIds.has(id)).length;
    const active_7d = [...active7dSet].filter((id) => !adminIds.has(id)).length;
    let appOpened7d = 0;
    let registrations7d = 0;
    for (const event of events) {
      if (adminIds.has(event.player_id)) continue;
      if (event.event_type === "app_opened") appOpened7d++;
      if (event.event_type === "registration_created") registrations7d++;
    }

    // User list includes admins only if their events were recorded (include_admin_activity=true)
    const users = [...playerEventMap.entries()]
      .map(([pid, stats]) => {
        const p = playerMap.get(pid);
        return {
          player_id: pid,
          display_name: p?.display_name ?? "Неизвестный",
          username: p?.username ?? null,
          email: p?.email ?? null,
          last_seen: stats.last_seen,
          last_event_type: stats.last_event_type,
          event_count_7d: stats.count,
        };
      })
      .sort((a, b) => b.last_seen.localeCompare(a.last_seen));

    return NextResponse.json({
      active_today,
      active_7d,
      app_opened_7d: appOpened7d,
      registrations_7d: registrations7d,
      users,
    });
  } catch (err) {
    console.error("[GET /api/admin/activity] error:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
