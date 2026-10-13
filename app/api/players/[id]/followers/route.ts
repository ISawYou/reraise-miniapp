import { NextResponse } from "next/server";
import { listFollowers, parseIntegerQueryParam } from "@/features/follows";
import { followsErrorResponse } from "@/lib/follows-error-response";

export const dynamic = "force-dynamic";

// GET /api/players/[id]/followers?limit=&offset= -- public (same public-ness
// as the profile itself). limit defaults to 50 and is clamped to 1..100; a
// malformed limit/offset falls back to its default. Items carry only
// id/display_name/telegram_avatar_url/custom_avatar_url (no username).
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);

    return NextResponse.json(
      await listFollowers(id, {
        limit: parseIntegerQueryParam(searchParams.get("limit")),
        offset: parseIntegerQueryParam(searchParams.get("offset")),
      })
    );
  } catch (error) {
    return followsErrorResponse(error, "Не удалось загрузить список. Попробуйте ещё раз.");
  }
}
