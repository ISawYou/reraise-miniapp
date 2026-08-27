import { NextResponse } from "next/server";
import {
  InvalidRoleError,
  LastSuperAdminError,
  SelfDemotionError,
  assignPlayerRole,
  listPlayersForRoleManagement,
} from "@/features/roles";
import { resolveCurrentServerActor } from "@/lib/admin-auth";

// Super-Admin-only -- NOT on the operator allowlist (see
// lib/admin-permissions.ts), so middleware.ts already guarantees only
// role === 'admin' ever reaches these handlers.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const players = await listPlayersForRoleManagement();
    return NextResponse.json({ players });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить список игроков" },
      { status: 500 }
    );
  }
}

// Actor identity is resolved server-side (never trusts a client-supplied
// player_id) purely for the self-demotion/last-super-admin lockout guards
// -- authorization itself is already middleware's job.
export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { playerId?: string; role?: string }
      | null;

    const playerId = body?.playerId?.trim();
    const role = body?.role?.trim();

    if (!playerId || !role) {
      return NextResponse.json({ error: "Не указан игрок или роль" }, { status: 400 });
    }

    const actor = await resolveCurrentServerActor();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const player = await assignPlayerRole(playerId, role, actor.id);
    return NextResponse.json({ player });
  } catch (error) {
    if (error instanceof InvalidRoleError) {
      return NextResponse.json({ error: "Неизвестная роль" }, { status: 400 });
    }
    if (error instanceof SelfDemotionError || error instanceof LastSuperAdminError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось изменить роль" },
      { status: 400 }
    );
  }
}
