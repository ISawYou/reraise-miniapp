import { NextResponse } from "next/server";
import { uploadTournamentVisualPng } from "@/features/tournament-visuals";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const tournamentType = formData.get("tournamentType");
    const file = formData.get("file");
    if (typeof tournamentType !== "string" || !(file instanceof File)) {
      return NextResponse.json({ error: "tournamentType и PNG-файл обязательны" }, { status: 400 });
    }
    return NextResponse.json({ visual: await uploadTournamentVisualPng(tournamentType, file) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить PNG" },
      { status: 400 },
    );
  }
}
