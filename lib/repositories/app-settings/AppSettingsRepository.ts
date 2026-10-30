// Data-access boundary for app_settings — a generic key/value store.
// Deliberately a thin CRUD surface, not a business-logic layer: which keys
// exist, their meaning, and any defaulting all stay in lib/app-settings.ts
// exactly as before.
export type AppSettingRow = {
  key: string;
  value: unknown;
};

export interface AppSettingsRepository {
  // Only a genuinely absent row returns null. Storage/authorization errors throw.
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  // Read latest object and apply a synchronous, side-effect-free mutation in
  // one database transaction. Resolves only after COMMIT; unsupported providers
  // must reject, never emulate this using independent get/set requests.
  updateObject(key: string, mutate: (current: Record<string, unknown>) => Record<string, unknown>): Promise<Record<string, unknown>>;
  // Added for the Supabase→PostgreSQL backfill script — get/set both
  // require knowing a key upfront, with no way to enumerate what exists.
  // Not used by any route/feature today.
  listAll(): Promise<AppSettingRow[]>;
}
