import { NextResponse } from "next/server";
import { getProfileResults } from "@/features/profile-v2";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const raw = new URL(request.url).searchParams.get("offset") ?? "0";
  const offset = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(offset) || offset > 100_000) {
    return NextResponse.json({ error: "Некорректная страница" }, { status: 400 });
  }
  try {
    const { id } = await context.params;
    return NextResponse.json(await getProfileResults(id, offset));
  } catch {
    return NextResponse.json({ error: "Не удалось загрузить результаты" }, { status: 500 });
  }
}
