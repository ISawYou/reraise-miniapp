import { NextResponse } from "next/server";
import { listAdminShiftsForManagement } from "@/features/admin-shifts";

// Super-Admin-only (not on the operator allowlist -- see
// lib/admin-permissions.ts. "View all admin shifts" is explicitly a Super
// Admin capability per this release's scope).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const shifts = await listAdminShiftsForManagement();
    return NextResponse.json({ shifts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить смены" },
      { status: 500 }
    );
  }
}
