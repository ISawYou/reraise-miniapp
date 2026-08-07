import { NextResponse } from "next/server";
import { activateMysteryBounty } from "@/features/mystery-bounty";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const snapshot = await activateMysteryBounty(id);

    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to activate Mystery Bounty",
      },
      { status: 400 }
    );
  }
}
