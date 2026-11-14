import { NextResponse } from "next/server";
import { assertServerActorRole, ForbiddenActionError, UnauthorizedActionError } from "@/lib/admin-auth";

export async function POST() {
  try {
    await assertServerActorRole(["admin", "operator"]);
    return NextResponse.json(
      { code: "LEGACY_SHEETS_RETIRED", error: "Синхронизация с Google Sheets отключена; источником является PostgreSQL" },
      { status: 410 }
    );
  } catch (error) {
    const status = error instanceof UnauthorizedActionError ? 401 : error instanceof ForbiddenActionError ? 403 : 409;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка авторизации" }, { status });
  }
}
