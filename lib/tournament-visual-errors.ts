import { NextResponse } from "next/server";
import { AppSettingsStorageError, AtomicSettingsUnsupportedError, InvalidStoredSettingError } from "@/lib/app-settings-errors";

export class TournamentVisualValidationError extends Error {}

export async function readTournamentVisualCommand(request: Request): Promise<Record<string, unknown>> {
  const value: unknown = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TournamentVisualValidationError("Некорректная команда оформления");
  return value as Record<string, unknown>;
}

export function tournamentVisualErrorResponse(error: unknown, operation: string) {
  if (error instanceof TournamentVisualValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const code = error instanceof AppSettingsStorageError ? error.code : undefined;
  const conflict = code === "40001" || code === "40P01";
  const unsupported = error instanceof AtomicSettingsUnsupportedError;
  console.error("[tournament-visuals] operation failed", {
    operation, code, kind: unsupported ? "unsupported-provider" : error instanceof InvalidStoredSettingError ? "invalid-stored-data" : "storage",
  });
  return NextResponse.json({ error: conflict ? "Конфликт сохранения. Загрузите настройки заново и повторите попытку." : unsupported ? error.message : "Не удалось загрузить или сохранить оформление. Обновите настройки перед повторной попыткой." }, { status: conflict ? 409 : unsupported ? 503 : 500 });
}
