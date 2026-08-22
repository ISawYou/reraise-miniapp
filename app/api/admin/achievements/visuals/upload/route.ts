import { NextResponse } from "next/server";
import { uploadAchievementPng } from "@/features/achievement-visuals";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const visualKey = formData.get("visualKey");
    const file = formData.get("file");
    if (typeof visualKey !== "string" || !(file instanceof File)) {
      return NextResponse.json({ error: "visualKey и PNG-файл обязательны" }, { status: 400 });
    }
    return NextResponse.json({ visual: await uploadAchievementPng(visualKey, file) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить PNG" },
      { status: 400 },
    );
  }
}
