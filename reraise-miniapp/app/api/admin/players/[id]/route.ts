import { NextResponse } from "next/server";
import { deleteManualPlayer } from "@/features/admin";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await deleteManualPlayer(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка удаления игрока" },
      { status: 500 }
    );
  }
}
