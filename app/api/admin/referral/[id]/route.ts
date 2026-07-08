import { NextResponse } from "next/server";
import {
  updatePlayerReferralData,
  type ReferralAction,
} from "@/features/admin";

const VALID_ACTIONS: ReferralAction[] = [
  "increment_referral",
  "decrement_referral",
  "increment_free_reentries",
  "decrement_free_reentries",
  "set_yandex_review",
];

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      action?: string;
      value?: boolean;
    };

    if (!body.action || !VALID_ACTIONS.includes(body.action as ReferralAction)) {
      return NextResponse.json(
        { error: "Некорректное действие" },
        { status: 400 }
      );
    }

    if (body.action === "set_yandex_review" && typeof body.value !== "boolean") {
      return NextResponse.json(
        { error: "Для set_yandex_review требуется boolean value" },
        { status: 400 }
      );
    }

    const player = await updatePlayerReferralData(
      id,
      body.action as ReferralAction,
      body.value
    );

    return NextResponse.json({ player });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Ошибка обновления реферальных данных",
      },
      { status: 500 }
    );
  }
}
