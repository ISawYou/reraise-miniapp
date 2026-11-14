import { NextResponse } from "next/server";
import { assertServerActorRole } from "@/lib/admin-auth";
import { applyCompletedIdentityCorrection, IdentityCorrectionError, previewCompletedIdentityCorrection } from "@/lib/repositories/qualification/completed-identity-correction";

export const dynamic = "force-dynamic";

function failure(error: unknown) {
  const status = error instanceof IdentityCorrectionError ? error.status : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка коррекции identity" }, { status });
}

export async function GET(request: Request) {
  try {
    await assertServerActorRole(["admin"]);
    const expectedVersion = new URL(request.url).searchParams.get("version");
    return NextResponse.json(await previewCompletedIdentityCorrection(expectedVersion ? Number(expectedVersion) : undefined));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await assertServerActorRole(["admin"]);
    const body = await request.json().catch(() => null) as { expectedVersion?: unknown; reason?: unknown } | null;
    if (!body || !Number.isSafeInteger(body.expectedVersion) || typeof body.reason !== "string") return NextResponse.json({ error: "Требуются expectedVersion и reason" }, { status: 400 });
    return NextResponse.json(await applyCompletedIdentityCorrection(actor.id, body.expectedVersion as number, body.reason));
  } catch (error) { return failure(error); }
}
