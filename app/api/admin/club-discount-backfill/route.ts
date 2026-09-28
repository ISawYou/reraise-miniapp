import { NextResponse } from "next/server";
import { previewClubDiscountBackfill, applyClubDiscountBackfill } from "@/features/club-discount-backfill";

// Super-Admin only (see middleware.ts's three-tier authorization — this
// route is NOT on lib/admin-permissions.ts's operator allowlist, so an
// operator is denied by default, fail-closed).
//
// Preview is READ-ONLY; apply only ever writes the exact result ids the
// caller previewed and is asked to confirm (see
// features/club-discount-backfill.ts's own doc comment for the full
// safety contract this route just forwards to).
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      mode?: "preview" | "apply";
      playerId?: string;
      discountPercent?: number;
      effectiveFrom?: string;
      effectiveTo?: string | null;
      resultIds?: string[];
    };

    if (body.mode !== "preview" && body.mode !== "apply") {
      return NextResponse.json({ error: "mode должен быть 'preview' или 'apply'" }, { status: 400 });
    }
    if (typeof body.playerId !== "string" || body.playerId.length === 0) {
      return NextResponse.json({ error: "playerId обязателен" }, { status: 400 });
    }
    if (typeof body.discountPercent !== "number") {
      return NextResponse.json({ error: "discountPercent обязателен" }, { status: 400 });
    }

    if (body.mode === "preview") {
      if (typeof body.effectiveFrom !== "string") {
        return NextResponse.json({ error: "effectiveFrom обязателен для preview" }, { status: 400 });
      }
      const preview = await previewClubDiscountBackfill({
        playerId: body.playerId,
        discountPercent: body.discountPercent,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo,
      });
      return NextResponse.json({ preview });
    }

    if (!Array.isArray(body.resultIds)) {
      return NextResponse.json({ error: "resultIds обязателен для apply" }, { status: 400 });
    }
    const result = await applyClubDiscountBackfill({
      playerId: body.playerId,
      discountPercent: body.discountPercent,
      resultIds: body.resultIds,
    });
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось выполнить операцию" },
      { status: 400 },
    );
  }
}
