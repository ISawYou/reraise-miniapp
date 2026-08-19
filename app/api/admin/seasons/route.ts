import { NextResponse } from "next/server";
import { seasonRepository } from "@/lib/repositories";

// Trivial read-only pass-through (matches the existing precedent of simple
// admin GETs calling a Repository directly, e.g. the achievements resync
// route's playerRepository.listOrderedByCreatedAtDesc()) -- lets the admin
// UI show which season is currently active before offering to close it.
export async function GET() {
  try {
    const seasons = await seasonRepository.listAll();
    return NextResponse.json({ seasons });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить сезоны" },
      { status: 500 }
    );
  }
}
