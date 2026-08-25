import { NextResponse } from "next/server";
import {
  closeTournamentLateRegistrationOperation,
  getTournamentLateRegistrationSnapshot,
} from "@/features/late-registration";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const snapshot = await getTournamentLateRegistrationSnapshot(id);
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load Late Registration" },
      { status: 500 }
    );
  }
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const result = await closeTournamentLateRegistrationOperation(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to close Late Registration" },
      { status: 400 }
    );
  }
}
