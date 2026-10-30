import { NextResponse } from "next/server";
import { getProfileV2 } from "@/features/profile-v2";
import { resolveCurrentServerActor } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const viewer = await resolveCurrentServerActor();

  try {
    const response = await getProfileV2({
      targetPlayerId: id,
      viewerId: viewer?.id ?? null,
    });
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить профиль" },
      { status: 500 },
    );
  }
}
