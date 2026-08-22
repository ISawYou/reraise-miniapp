import { NextResponse } from "next/server";
import { playerRepository } from "@/lib/repositories";

export async function GET() {
  const players = await playerRepository.listOrderedByDisplayName();
  return NextResponse.json({
    players: players.map(({ id, display_name, username }) => ({ id, display_name, username })),
  });
}
