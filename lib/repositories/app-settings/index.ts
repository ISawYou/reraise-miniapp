import { SupabaseAppSettingsRepository } from "./SupabaseAppSettingsRepository";
import type { AppSettingsRepository } from "./AppSettingsRepository";

export type { AppSettingsRepository } from "./AppSettingsRepository";

export const appSettingsRepository: AppSettingsRepository =
  new SupabaseAppSettingsRepository();
