import "server-only";
import { appSettingsRepository } from "@/lib/repositories";

export async function getAppSetting(key: string): Promise<unknown> {
  return appSettingsRepository.get(key);
}

export async function setAppSetting(key: string, value: unknown): Promise<void> {
  return appSettingsRepository.set(key, value);
}

export async function updateAppSettingObject(key: string, mutate: (current: Record<string, unknown>) => Record<string, unknown>) {
  return appSettingsRepository.updateObject(key, mutate);
}
