import { type NextRequest, NextResponse } from "next/server";
import {
  ClubActivityValidationError,
  createManualClubActivity,
  getClubActivityAdminList,
} from "@/features/club-activity";

export async function GET() {
  try {
    return NextResponse.json({ events: await getClubActivityAdminList() });
  } catch (error) {
    console.error("[GET /api/admin/club-activity] error:", error);
    return NextResponse.json({ error: "Не удалось загрузить публикации" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    return NextResponse.json({ event: await createManualClubActivity({
      eventType: body.eventType,
      title: body.title,
      body: body.body,
      imageUrl: body.imageUrl,
      ctaLabel: body.ctaLabel,
      ctaUrl: body.ctaUrl,
      status: body.status,
    }) }, { status: 201 });
  } catch (error) {
    if (error instanceof ClubActivityValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[POST /api/admin/club-activity] error:", error);
    return NextResponse.json({ error: "Не удалось создать публикацию" }, { status: 500 });
  }
}
