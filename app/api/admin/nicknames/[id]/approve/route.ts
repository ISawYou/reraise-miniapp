import { NextResponse } from "next/server";
import { approveNickname } from "@/features/auth";
import { resolveCurrentServerActor } from "@/lib/admin-auth";

// Deliberately narrower than PATCH /api/admin/nicknames/:id (Super-Admin-
// only, also supports reject and set_admin_display_name) -- this is the
// ONE nickname-moderation action an operator gets. No body is read: there
// is no `display_name` (or any other) field to accept, so a caller can
// never override what gets approved -- approveNickname() always applies
// whatever the player currently has in pending_display_name, exactly as
// submitted, and throws if that player isn't actually pending. On the
// operator allowlist, see lib/admin-permissions.ts.
export async function PATCH(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const player = await approveNickname(id);
    const actor = await resolveCurrentServerActor();

    // Same "allowed route, reduced payload" split as GET
    // /api/admin/dealers and GET /api/admin/nicknames/pending -- an
    // operator caller never sees email/role/is_blocked/etc.
    if (actor?.role !== "admin") {
      return NextResponse.json({
        player: {
          id: player.id,
          username: player.username,
          display_name: player.display_name,
          admin_display_name: player.admin_display_name,
        },
      });
    }

    return NextResponse.json({ player });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось одобрить ник" },
      { status: 500 }
    );
  }
}
