import { NextResponse } from "next/server";
import { getPendingNicknames } from "@/features/auth";
import { resolveCurrentServerActor } from "@/lib/admin-auth";

// GET is on the operator allowlist (see lib/admin-permissions.ts) --
// operator needs "see pending nickname submissions to approve them". The
// query itself is already scoped to nickname_status='pending' (see
// listPendingNicknames), so this is narrow in WHICH players; the payload
// below is additionally narrowed in WHICH FIELDS for a non-admin caller,
// same "allowed route, reduced payload" split as GET /api/admin/dealers --
// an operator has no reason to see email/role/is_blocked/referral stats/
// etc. for a player they're only approving a submitted nickname for.
export async function GET() {
  try {
    const players = await getPendingNicknames();
    const actor = await resolveCurrentServerActor();

    if (actor?.role !== "admin") {
      return NextResponse.json({
        players: players.map((player) => ({
          id: player.id,
          username: player.username,
          display_name: player.display_name,
          admin_display_name: player.admin_display_name,
          pending_display_name: player.pending_display_name,
        })),
      });
    }

    return NextResponse.json({ players });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось загрузить ники на модерации",
      },
      { status: 500 }
    );
  }
}
