import { NextResponse } from "next/server";
import { assertServerActorRole, ForbiddenActionError, UnauthorizedActionError } from "@/lib/admin-auth";

function retired(error?: unknown) {
  if (error) {
    const status = error instanceof UnauthorizedActionError ? 401 : error instanceof ForbiddenActionError ? 403 : 409;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка авторизации" }, { status });
  }
  return NextResponse.json(
    { code: "SOURCE_CUTOVER_RETIRED", error: "Переключение Google Sheets → PostgreSQL больше не требуется: PostgreSQL уже является каноническим источником" },
    { status: 410 }
  );
}
export async function GET() {
  try { await assertServerActorRole(["admin"]); return retired(); }
  catch (error) { return retired(error); }
}
export async function POST() {
  try { await assertServerActorRole(["admin"]); return retired(); }
  catch (error) { return retired(error); }
}
