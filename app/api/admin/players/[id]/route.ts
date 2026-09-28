import { NextResponse } from "next/server";
import { deleteManualPlayer, setPlayerBlocked, setPlayerClubDiscount } from "@/features/admin";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      action?: "block" | "unblock" | "setClubDiscount";
      clubDiscountPercent?: number;
    };

    if (body.action === "block" || body.action === "unblock") {
      const player = await setPlayerBlocked(id, body.action === "block");
      return NextResponse.json({ player });
    }

    if (body.action === "setClubDiscount") {
      if (typeof body.clubDiscountPercent !== "number") {
        return NextResponse.json({ error: "Не указан процент скидки" }, { status: 400 });
      }
      const player = await setPlayerClubDiscount(id, body.clubDiscountPercent);
      return NextResponse.json({ player });
    }

    return NextResponse.json({ error: "Некорректное действие" }, { status: 400 });
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
