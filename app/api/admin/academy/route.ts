import { NextResponse } from "next/server";
import { getAcademyAdminProgress } from "@/features/academy";

export async function GET() {
  try {
    return NextResponse.json(await getAcademyAdminProgress());
  } catch (error) {
    console.error("Failed to load Academy admin progress:", error);
    return NextResponse.json({ error: "Не удалось загрузить прогресс Academy" }, { status: 500 });
  }
}
