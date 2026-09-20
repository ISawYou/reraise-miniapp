import { NextResponse } from "next/server";
import { setPlayerReferralCount } from "@/features/admin";

// Narrow operator-safe referral mutation -- accepts ONLY the exact desired
// referral_count (non-negative integer), never the legacy bundled actions
// (free re-entry balance, Yandex review bonus) exposed by the generic
// PATCH /api/admin/referral/:id route, which stays Super-Admin-only and is
// deliberately NOT allowlisted for operator (see lib/admin-permissions.ts's
// doc comment on why). This route IS allowlisted for operator.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as { referralCount?: number } | null;

    if (!body || typeof body.referralCount !== "number") {
      return NextResponse.json({ error: "referralCount обязателен" }, { status: 400 });
    }

    const player = await setPlayerReferralCount(id, body.referralCount);
    return NextResponse.json({ player });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Ошибка обновления реферальных данных",
      },
      { status: 400 }
    );
  }
}
