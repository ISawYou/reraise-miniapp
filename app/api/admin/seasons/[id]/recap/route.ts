import { NextResponse } from "next/server";
import { getSeasonRecap } from "@/features/season-recap";

// Super-Admin-only, read-only -- same gate as the rest of
// /api/admin/seasons/** (not on the operator allowlist in
// lib/admin-permissions.ts, so middleware.ts denies operator by default).
// Response carries public player identity (id/display_name) only -- no
// telegram_id, email, role, or season internal dates beyond what the recap
// itself needs (it needs none).
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  try {
    const recap = await getSeasonRecap(id);
    return NextResponse.json(recap);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось построить итоги сезона" },
      { status: 400 }
    );
  }
}
