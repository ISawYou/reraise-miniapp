import { NextResponse } from "next/server";
import { listTodayDealerShifts } from "@/features/dealers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const summary = await listTodayDealerShifts();
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить смены за сегодня" },
      { status: 500 }
    );
  }
}
