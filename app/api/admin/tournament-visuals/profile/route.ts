import { NextResponse } from "next/server";
import { resetTournamentVisualProfileGeometry, saveTournamentVisualProfileGeometry } from "@/features/tournament-visuals";
import { readTournamentVisualCommand, tournamentVisualErrorResponse, TournamentVisualValidationError } from "@/lib/tournament-visual-errors";

// Protected by the existing /api/admin/** middleware: admin only, operators
// are denied by the default-closed route allowlist.
export async function PUT(request: Request) {
  try {
    const { tournamentType, geometry } = await readTournamentVisualCommand(request);
    if (typeof tournamentType !== "string") throw new TournamentVisualValidationError("tournamentType обязателен");
    return NextResponse.json({ visual: await saveTournamentVisualProfileGeometry(tournamentType, geometry) });
  } catch (error) {
    return tournamentVisualErrorResponse(error, "save-profile");
  }
}

export async function DELETE(request: Request) {
  try {
    const { tournamentType } = await readTournamentVisualCommand(request);
    if (typeof tournamentType !== "string") throw new TournamentVisualValidationError("tournamentType обязателен");
    return NextResponse.json({ visual: await resetTournamentVisualProfileGeometry(tournamentType) });
  } catch (error) {
    return tournamentVisualErrorResponse(error, "reset-profile");
  }
}
