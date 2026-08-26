import { NextResponse } from "next/server";
import { deleteManualPlayer, setPlayerBlocked } from "@/features/admin";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { action?: "block" | "unblock" };

    if (body.action !== "block" && body.action !== "unblock") {
      return NextResponse.json({ error: "Некорректное действие" }, { status: 400 });
    }

    const player = await setPlayerBlocked(id, body.action === "block");
    return NextResponse.json({ player });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось обновить статус игрока" },
      { status: 500 }
    );
  }
}

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
