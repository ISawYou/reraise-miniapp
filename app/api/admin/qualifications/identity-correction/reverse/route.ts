import { NextResponse } from "next/server";
import { assertServerActorRole } from "@/lib/admin-auth";
import { IdentityCorrectionError, reverseCompletedIdentityCorrection } from "@/lib/repositories/qualification/completed-identity-correction";

export const dynamic = "force-dynamic";

function failure(error: unknown) {
  const status = error instanceof IdentityCorrectionError ? error.status : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка reversal identity" }, { status });
}

export async function POST(request: Request) {
  try {
    const actor = await assertServerActorRole(["admin"]);
    const body = await request.json().catch(() => null) as { originalAuditId?: unknown; expectedVersion?: unknown; reason?: unknown } | null;
    if (!body || typeof body.originalAuditId !== "string" || !Number.isSafeInteger(body.expectedVersion) || typeof body.reason !== "string") return NextResponse.json({ error: "Требуются originalAuditId, expectedVersion и reason" }, { status: 400 });
    return NextResponse.json(await reverseCompletedIdentityCorrection(actor.id, body.originalAuditId, body.expectedVersion as number, body.reason));
  } catch (error) { return failure(error); }
}
