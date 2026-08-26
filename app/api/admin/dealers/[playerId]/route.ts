import { NextResponse } from "next/server";
import {
  DealerHasOpenShiftError,
  DealerNotFoundError,
  deactivateDealer,
  updateDealerHourlyRate,
} from "@/features/dealers";

export const dynamic = "force-dynamic";

// "Убрать из дилеров" -- flips dealer_profiles.is_active = false. Never
// deletes the profile row or any historical shift.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ playerId: string }> }
) {
  const { playerId } = await params;

  try {
    await deactivateDealer(playerId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof DealerNotFoundError) {
      return NextResponse.json({ error: "Дилер не найден" }, { status: 404 });
    }
    if (error instanceof DealerHasOpenShiftError) {
      return NextResponse.json(
        { error: "Нельзя убрать из дилеров: есть открытая смена" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось убрать дилера" },
      { status: 400 }
    );
  }
}

// Rate editing -- only ever affects future shifts (see
// features/dealers.ts::updateDealerHourlyRate).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ playerId: string }> }
) {
  const { playerId } = await params;

  try {
    const body = (await request.json().catch(() => null)) as { hourlyRateRub?: number } | null;

    if (typeof body?.hourlyRateRub !== "number") {
      return NextResponse.json({ error: "Не указана ставка" }, { status: 400 });
    }

    const profile = await updateDealerHourlyRate(playerId, body.hourlyRateRub);
    return NextResponse.json({ profile });
  } catch (error) {
    if (error instanceof DealerNotFoundError) {
      return NextResponse.json({ error: "Дилер не найден" }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось изменить ставку" },
      { status: 400 }
    );
  }
}
