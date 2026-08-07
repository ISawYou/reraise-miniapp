import { NextResponse } from "next/server";
import { closeMysteryBountyLateRegistration } from "@/features/mystery-bounty";

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
          }>;
        }
      | null;

    const snapshot = await closeMysteryBountyLateRegistration(id, body?.rows ?? []);

    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to close Mystery Bounty late registration",
      },
      { status: 400 }
    );
  }
}
