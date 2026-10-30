import { NextResponse } from "next/server";
import { uploadTournamentVisualPng } from "@/features/tournament-visuals";
import { tournamentVisualErrorResponse, TournamentVisualValidationError } from "@/lib/tournament-visual-errors";

export async function POST(request: Request) {
  try {
    const formData = await request.formData().catch(() => { throw new TournamentVisualValidationError("Некорректная форма загрузки PNG"); });
    const tournamentType = formData.get("tournamentType");
    const file = formData.get("file");
    if (typeof tournamentType !== "string" || !(file instanceof File)) {
      return NextResponse.json({ error: "tournamentType и PNG-файл обязательны" }, { status: 400 });
    }
    return NextResponse.json({ visual: await uploadTournamentVisualPng(tournamentType, file) });
  } catch (error) {
    return tournamentVisualErrorResponse(error, "upload");
  }
}
