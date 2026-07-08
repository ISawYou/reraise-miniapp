// Data-access boundary for app_settings — a generic key/value store.
// Deliberately a thin CRUD surface, not a business-logic layer: which keys
// exist, their meaning, and any defaulting all stay in lib/app-settings.ts
// exactly as before.
export interface AppSettingsRepository {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}
