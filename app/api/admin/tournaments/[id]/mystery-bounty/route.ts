import { NextResponse } from "next/server";
import { getMysteryBountySnapshot } from "@/features/mystery-bounty";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const snapshot = await getMysteryBountySnapshot(id);

    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load Mystery Bounty snapshot",
      },
      { status: 500 }
    );
  }
}
