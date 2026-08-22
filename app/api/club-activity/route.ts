import { type NextRequest, NextResponse } from "next/server";
import { getPublishedClubActivity } from "@/features/club-activity";

export async function GET(request: NextRequest) {
  try {
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "20");
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
    const events = await getPublishedClubActivity(
      Number.isFinite(limit) ? limit : 20,
      Number.isFinite(offset) ? offset : 0,
    );
    return NextResponse.json({ events });
  } catch (error) {
    console.error("[GET /api/club-activity] error:", error);
    return NextResponse.json({ error: "Не удалось загрузить ленту" }, { status: 500 });
  }
}
