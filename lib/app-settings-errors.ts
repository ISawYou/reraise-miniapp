export class InvalidStoredSettingError extends Error {
  constructor() { super("Сохранённые настройки повреждены"); this.name = "InvalidStoredSettingError"; }
}

export class AtomicSettingsUnsupportedError extends Error {
  constructor() { super("Атомарное сохранение оформления недоступно для этого источника данных"); this.name = "AtomicSettingsUnsupportedError"; }
}

// Never retain SQL, parameters, credentials or raw database messages in the
// error that shared consumers may log. SQLSTATE is enough to classify retryable
// conflicts without exposing the original driver exception.
export class AppSettingsStorageError extends Error {
  readonly code: string | undefined;
  constructor(readonly operation: string, error: unknown) {
    super("Не удалось выполнить операцию с настройками");
    this.name = "AppSettingsStorageError";
    const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
    const code = candidate?.code ?? candidate?.cause?.code;
    this.code = typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : undefined;
  }
}

export function storedObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidStoredSettingError();
  return value as Record<string, unknown>;
}
