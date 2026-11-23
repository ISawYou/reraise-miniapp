import { NextResponse } from "next/server";
import { assertServerActorRole, ForbiddenActionError, UnauthorizedActionError } from "@/lib/admin-auth";
import { PkoLedgerError, pkoLedgerRepository } from "@/lib/repositories/pko/PostgresPkoLedgerRepository";
import { PkoAccountingError } from "@/lib/progressive-knockout-core";

type Context = { params: Promise<{ id: string }> };
const noStore = { "Cache-Control": "no-store" };

function errorResponse(error: unknown) {
  const status = error instanceof UnauthorizedActionError ? 401
    : error instanceof ForbiddenActionError ? 403
      : error instanceof PkoLedgerError ? error.status
        : error instanceof PkoAccountingError ? 400 : 500;
  return NextResponse.json({
    error: status === 500 ? "Не удалось прочитать или изменить журнал PKO" : (error as Error).message,
  }, { status, headers: noStore });
}

export async function GET(_request: Request, { params }: Context) {
  try {
    await assertServerActorRole(["admin", "operator"]);
    if (process.env.DATABASE_PROVIDER !== "postgres") {
      return NextResponse.json({ error: "Для PKO необходим PostgreSQL" }, { status: 503, headers: noStore });
    }
    const { id } = await params;
    return NextResponse.json(await pkoLedgerRepository.read(id), { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await assertServerActorRole(["admin", "operator"]);
    if (process.env.DATABASE_PROVIDER !== "postgres") {
      return NextResponse.json({ error: "Для PKO необходим PostgreSQL" }, { status: 503, headers: noStore });
    }
    const body = await request.json().catch(() => null);
    if (!body || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || !body.event) {
      return NextResponse.json({ error: "Нужны expectedRevision и событие PKO" }, { status: 400, headers: noStore });
    }
    const { id } = await params;
    return NextResponse.json(await pkoLedgerRepository.append({
      tournamentId: id, actorId: actor.id,
      expectedRevision: body.expectedRevision, event: body.event,
    }), { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
