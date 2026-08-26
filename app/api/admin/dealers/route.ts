import { NextResponse } from "next/server";
import { activateDealer, listActiveDealers } from "@/features/dealers";

// Admin-only -- protected by middleware.ts's blanket /api/admin/:path*
// role check (player.role === 'admin'), same as every other route under
// /api/admin.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const dealers = await listActiveDealers();
    return NextResponse.json({ dealers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить дилеров" },
      { status: 500 }
    );
  }
}

// "Добавить дилера" -- activates (or re-activates) an EXISTING player's
// dealer profile. Never creates a second player row.
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { playerId?: string } | null;
    const playerId = body?.playerId?.trim();

    if (!playerId) {
      return NextResponse.json({ error: "Не указан игрок" }, { status: 400 });
    }

    const profile = await activateDealer(playerId);
    return NextResponse.json({ profile });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось назначить дилера" },
      { status: 400 }
    );
  }
}
