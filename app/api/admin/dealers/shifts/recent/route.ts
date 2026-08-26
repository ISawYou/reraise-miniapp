import { NextResponse } from "next/server";
import { listRecentDealerShifts } from "@/features/dealers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const shifts = await listRecentDealerShifts();
    return NextResponse.json({ shifts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить историю смен" },
      { status: 500 }
    );
  }
}
