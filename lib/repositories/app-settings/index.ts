import { SupabaseAppSettingsRepository } from "./SupabaseAppSettingsRepository";
import { PostgresAppSettingsRepository } from "./PostgresAppSettingsRepository";
import type { AppSettingsRepository } from "./AppSettingsRepository";

export type { AppSettingsRepository } from "./AppSettingsRepository";

const usePostgres = process.env.DATABASE_PROVIDER === "postgres";

export const appSettingsRepository: AppSettingsRepository = usePostgres
  ? new PostgresAppSettingsRepository()
  : new SupabaseAppSettingsRepository();
