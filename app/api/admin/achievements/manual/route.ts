import { NextResponse } from "next/server";
import {
  getManualAchievementsForPlayer,
  grantManualAchievement,
  revokeManualAchievement,
} from "@/features/achievements";

// Manual achievement moderation for a single player (Royal Flush today,
// any future type=MANUAL achievement without changes here). Protected by
// middleware.ts's blanket `/api/admin/:path*` admin-role gate — no
// separate auth code needed. The actual type=MANUAL guard lives in
// features/achievements.ts (grantManualAchievement/revokeManualAchievement
// throw for an automatic code) — enforced server-side regardless of what
// the UI sends, not just hidden from it.

export async function GET(request: Request) {
  const playerId = new URL(request.url).searchParams.get("playerId");

  if (!playerId) {
    return NextResponse.json({ error: "playerId обязателен" }, { status: 400 });
  }

  try {
    const achievements = await getManualAchievementsForPlayer(playerId);
    return NextResponse.json({ achievements });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить достижения" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    playerId?: string;
    code?: string;
  };

  if (!body.playerId || !body.code) {
    return NextResponse.json({ error: "playerId и code обязательны" }, { status: 400 });
  }

  try {
    await grantManualAchievement(body.playerId, body.code);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось выдать достижение" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    playerId?: string;
    code?: string;
  };

  if (!body.playerId || !body.code) {
    return NextResponse.json({ error: "playerId и code обязательны" }, { status: 400 });
  }

  try {
    await revokeManualAchievement(body.playerId, body.code);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось снять достижение" },
      { status: 400 }
    );
  }
}
