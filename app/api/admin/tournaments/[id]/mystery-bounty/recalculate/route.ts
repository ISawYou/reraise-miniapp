import { NextResponse } from "next/server";
import { recalculateMysteryBounty } from "@/features/mystery-bounty";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as
      | {
          rows?: Array<{
            player_id: string;
            arrived: boolean;
            rebuys: number;
            addons: number;
            mystery_bounty_points?: number;
          }>;
        }
      | null;

    const snapshot = await recalculateMysteryBounty(id, body?.rows ?? []);

    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to recalculate Mystery Bounty",
      },
      { status: 400 }
    );
  }
}
