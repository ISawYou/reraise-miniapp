import { type NextRequest, NextResponse } from "next/server";
import {
  archiveManualClubActivity,
  ClubActivityValidationError,
  updateManualClubActivity,
} from "@/features/club-activity";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const body = await request.json();
    return NextResponse.json({ event: await updateManualClubActivity(id, {
      eventType: body.eventType,
      title: body.title,
      body: body.body,
      imageUrl: body.imageUrl,
      ctaLabel: body.ctaLabel,
      ctaUrl: body.ctaUrl,
      status: body.status,
    }) });
  } catch (error) {
    if (error instanceof ClubActivityValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[PATCH /api/admin/club-activity/:id] error:", error);
    return NextResponse.json({ error: "Не удалось обновить публикацию" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    await archiveManualClubActivity(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ClubActivityValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[DELETE /api/admin/club-activity/:id] error:", error);
    return NextResponse.json({ error: "Не удалось архивировать публикацию" }, { status: 500 });
  }
}
