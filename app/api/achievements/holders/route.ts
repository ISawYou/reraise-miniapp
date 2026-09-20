import { NextResponse } from "next/server";
import { getAchievementHolders } from "@/features/club-statistics";

// Read-only, public. `code` is validated against a fixed allowlist -- only
// the two MANUAL/event-based achievements this release adds a holders list
// for (Royal Flush, Number One). No arbitrary code is ever passed through
// to the repository from an unvalidated request.
const VALID_CODES = new Set(["royal_flush", "number_one"]);

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");

  if (!code || !VALID_CODES.has(code)) {
    return NextResponse.json({ error: "Unknown achievement code" }, { status: 400 });
  }

  try {
    const holders = await getAchievementHolders(code);
    return NextResponse.json({ code, holders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить список" },
      { status: 500 }
    );
  }
}
