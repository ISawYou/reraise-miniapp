import { NextResponse } from "next/server";
import {
  CompletedPlaceCorrectionRejectedError,
  correctCompletedTournamentPlaces,
  type CompletedPlaceCorrectionRow,
} from "@/features/completed-tournament-place-correction";
import { ForbiddenActionError, UnauthorizedActionError } from "@/lib/admin-auth";
import { TournamentNotFoundError } from "@/lib/tournament-errors";

// "Исправить места" for an ALREADY-COMPLETED tournament -- Super Admin only.
// Deliberately NOT listed in lib/admin-permissions.ts's
// OPERATOR_ALLOWED_ROUTES (middleware denies operator by default), and the
// feature function itself re-checks assertServerActorRole(["admin"]).
// `rows` must be the FULL current result set (every resulted player with
// their requested place); the server re-reads and rejects stale requests
// (see features/completed-tournament-place-correction.ts).
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as { rows?: unknown } | null;

    const rows = body?.rows;
    const isValidShape =
      Array.isArray(rows) &&
      rows.every(
        (row) =>
          !!row &&
          typeof row === "object" &&
          typeof (row as { player_id?: unknown }).player_id === "string" &&
          Number.isInteger((row as { place?: unknown }).place)
      );

    if (!isValidShape) {
      return NextResponse.json(
        { error: "rows ({ player_id: string, place: number }[]) обязателен" },
        { status: 400 }
      );
    }

    const result = await correctCompletedTournamentPlaces(
      id,
      (rows as CompletedPlaceCorrectionRow[]).map((row) => ({
        player_id: row.player_id,
        place: row.place,
      }))
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof UnauthorizedActionError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenActionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof TournamentNotFoundError) {
      return NextResponse.json({ error: "Турнир не найден" }, { status: 404 });
    }
    if (error instanceof CompletedPlaceCorrectionRejectedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Не удалось исправить места",
      },
      { status: 500 }
    );
  }
}
