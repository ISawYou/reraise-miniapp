import { NextResponse } from "next/server";
import { getPendingNicknames } from "@/features/auth";

export async function GET() {
  try {
    const players = await getPendingNicknames();
    return NextResponse.json({ players });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось загрузить ники на модерации",
      },
      { status: 500 }
    );
  }
}
