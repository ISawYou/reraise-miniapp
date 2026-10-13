import { NextResponse } from "next/server";
import { listFollowing, parseIntegerQueryParam } from "@/features/follows";
import { followsErrorResponse } from "@/lib/follows-error-response";

export const dynamic = "force-dynamic";

// GET /api/players/[id]/following?limit=&offset= -- public. Same pagination
// and payload rules as /followers (no username). The unpaginated id list for
// the leaderboard lives at /following/ids.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);

    return NextResponse.json(
      await listFollowing(id, {
        limit: parseIntegerQueryParam(searchParams.get("limit")),
        offset: parseIntegerQueryParam(searchParams.get("offset")),
      })
    );
  } catch (error) {
    return followsErrorResponse(error, "Не удалось загрузить список. Попробуйте ещё раз.");
  }
}
