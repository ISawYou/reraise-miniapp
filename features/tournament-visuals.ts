import { randomUUID } from "crypto";
import {
  TOURNAMENT_VISUAL_TYPES,
  getDefaultTournamentVisual,
  isTournamentVisualType,
  type TournamentVisualConfig,
} from "@/config/tournament-visuals";
import { getAppSetting, setAppSetting } from "@/lib/app-settings";
import { tournamentAssetStorageRepository } from "@/lib/repositories";
import type { TournamentType } from "@/types/domain";

// Persisted as a single app_settings row (generic key-value store) rather
// than a dedicated table -- there is no tournament-visuals migration, and
// per-domain repositories never call other repositories, so this feature
// orchestrates the AppSettings repository directly, same as any other
// cross-cutting Feature would.
const APP_SETTINGS_KEY = "tournament_visuals";
const MAX_PNG_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function validateGeometry(config: TournamentVisualConfig): void {
  if (!Number.isInteger(config.scale) || config.scale < 50 || config.scale > 200) {
    throw new Error("Scale должен быть целым числом от 50 до 200");
  }
  for (const [label, value] of [["X offset", config.offsetX], ["Y offset", config.offsetY]] as const) {
    if (!Number.isInteger(value) || value < -100 || value > 100) {
      throw new Error(`${label} должен быть целым числом от -100 до 100`);
    }
  }
  if (!Number.isInteger(config.opacity) || config.opacity < 0 || config.opacity > 100) {
    throw new Error("Opacity должен быть целым числом от 0 до 100");
  }
}

function isStoredTournamentVisualConfig(value: unknown): value is TournamentVisualConfig {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as TournamentVisualConfig).tournamentType === "string" &&
    isTournamentVisualType((value as TournamentVisualConfig).tournamentType)
  );
}

export async function getTournamentVisualConfigs(): Promise<TournamentVisualConfig[]> {
  const raw = (await getAppSetting(APP_SETTINGS_KEY)) as
    | Partial<Record<TournamentType, TournamentVisualConfig>>
    | null;

  const stored = new Map(
    Object.values(raw ?? {})
      .filter(isStoredTournamentVisualConfig)
      .map((config) => [config.tournamentType, config]),
  );

  return TOURNAMENT_VISUAL_TYPES.map(
    (tournamentType) => stored.get(tournamentType) ?? getDefaultTournamentVisual(tournamentType),
  );
}

export async function saveTournamentVisualConfig(
  input: TournamentVisualConfig,
): Promise<TournamentVisualConfig> {
  if (!isTournamentVisualType(input.tournamentType)) {
    throw new Error("Неизвестный тип турнира");
  }
  const config: TournamentVisualConfig = {
    ...input,
    assetUrl: input.assetUrl.trim(),
  };
  if (!config.assetUrl || (!config.assetUrl.startsWith("/") && !/^https:\/\//.test(config.assetUrl))) {
    throw new Error("Некорректный public asset URL");
  }
  validateGeometry(config);

  const all = await getTournamentVisualConfigs();
  const next = Object.fromEntries(
    all.map((existing) => [
      existing.tournamentType,
      existing.tournamentType === config.tournamentType ? config : existing,
    ]),
  );
  await setAppSetting(APP_SETTINGS_KEY, next);
  return config;
}

export async function resetTournamentVisualConfig(
  tournamentType: string,
): Promise<TournamentVisualConfig> {
  if (!isTournamentVisualType(tournamentType)) {
    throw new Error("Неизвестный тип турнира");
  }
  return saveTournamentVisualConfig(getDefaultTournamentVisual(tournamentType));
}

export async function uploadTournamentVisualPng(
  tournamentType: string,
  file: File,
): Promise<TournamentVisualConfig> {
  if (!isTournamentVisualType(tournamentType)) {
    throw new Error("Неизвестный тип турнира");
  }
  if (file.type !== "image/png") {
    throw new Error("Разрешены только PNG-файлы");
  }
  if (file.size <= 0 || file.size > MAX_PNG_BYTES) {
    throw new Error("Размер PNG должен быть от 1 байта до 5 МБ");
  }

  const bytes = await file.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, PNG_SIGNATURE.length);
  if (!PNG_SIGNATURE.every((byte, index) => signature[index] === byte)) {
    throw new Error("Файл не является корректным PNG");
  }

  const fileName = `${tournamentType}-${Date.now()}-${randomUUID()}.png`;
  const assetUrl = await tournamentAssetStorageRepository.upload(fileName, bytes);
  const existing =
    (await getTournamentVisualConfigs()).find((config) => config.tournamentType === tournamentType) ??
    getDefaultTournamentVisual(tournamentType);

  return saveTournamentVisualConfig({ ...existing, assetUrl });
}
