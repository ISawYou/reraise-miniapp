import { randomUUID } from "crypto";
import {
  TOURNAMENT_VISUAL_TYPES,
  getDefaultTournamentVisual,
  isTournamentVisualType,
  type TournamentVisualConfig,
  type TournamentVisualGeometry,
} from "@/config/tournament-visuals";
import { getAppSetting, setAppSetting } from "@/lib/app-settings";
import { tournamentAssetStorageRepository } from "@/lib/repositories";
import { createTournamentCardDerivative } from "@/lib/tournament-visual-card-derivative";
import type { TournamentType } from "@/types/domain";

// Persisted as a single app_settings row (generic key-value store) rather
// than a dedicated table -- there is no tournament-visuals migration, and
// per-domain repositories never call other repositories, so this feature
// orchestrates the AppSettings repository directly, same as any other
// cross-cutting Feature would.
const APP_SETTINGS_KEY = "tournament_visuals";
const MAX_PNG_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function validateGeometry(geometry: TournamentVisualGeometry, surfaceLabel = ""): void {
  const prefix = surfaceLabel ? `${surfaceLabel}: ` : "";
  if (!Number.isInteger(geometry.scale) || geometry.scale < 50 || geometry.scale > 200) {
    throw new Error(`${prefix}Scale должен быть целым числом от 50 до 200`);
  }
  for (const [label, value] of [["X offset", geometry.offsetX], ["Y offset", geometry.offsetY]] as const) {
    if (!Number.isInteger(value) || value < -100 || value > 100) {
      throw new Error(`${prefix}${label} должен быть целым числом от -100 до 100`);
    }
  }
  if (!Number.isInteger(geometry.opacity) || geometry.opacity < 0 || geometry.opacity > 100) {
    throw new Error(`${prefix}Opacity должен быть целым числом от 0 до 100`);
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

function isValidPublicAssetUrl(value: string): boolean {
  return !!value && (value.startsWith("/") || /^https:\/\//.test(value));
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

  return TOURNAMENT_VISUAL_TYPES.map((tournamentType) => {
    const defaultConfig = getDefaultTournamentVisual(tournamentType);
    const storedConfig = stored.get(tournamentType);
    if (!storedConfig) {
      return defaultConfig;
    }
    // Compatibility inheritance for a config saved before cardAssetUrl
    // existed (or before this type had a built-in derivative): if it still
    // points at the exact untouched built-in original, it's safe to
    // backfill just the derivative URL without touching any admin-tuned
    // geometry -- the admin never has to click Reset. Never applies once
    // assetUrl differs (a custom/replacement upload), which must keep
    // rendering its own original with no derivative until its own upload
    // produces one -- no false pairing with a derivative it doesn't own.
    if (
      storedConfig.cardAssetUrl === undefined &&
      defaultConfig.cardAssetUrl !== undefined &&
      storedConfig.assetUrl === defaultConfig.assetUrl
    ) {
      return { ...storedConfig, cardAssetUrl: defaultConfig.cardAssetUrl };
    }
    return storedConfig;
  });
}

export async function saveTournamentVisualConfig(
  input: TournamentVisualConfig,
): Promise<TournamentVisualConfig> {
  if (!isTournamentVisualType(input.tournamentType)) {
    throw new Error("Неизвестный тип турнира");
  }
  // A non-string cardAssetUrl (absent, or a malformed `null` from an old/
  // buggy client) is treated as "not provided" rather than validated --
  // this field is optional, so its absence is never an error.
  const cardAssetUrl =
    typeof input.cardAssetUrl === "string" ? input.cardAssetUrl.trim() : undefined;
  const config: TournamentVisualConfig = {
    ...input,
    assetUrl: input.assetUrl.trim(),
    ...(cardAssetUrl !== undefined ? { cardAssetUrl } : {}),
  };
  if (!isValidPublicAssetUrl(config.assetUrl)) {
    throw new Error("Некорректный public asset URL");
  }
  if (config.cardAssetUrl !== undefined && !isValidPublicAssetUrl(config.cardAssetUrl)) {
    throw new Error("Некорректный public asset URL для card-превью");
  }
  validateGeometry(config);
  if (config.list) {
    validateGeometry(config.list, "Список турниров");
  }

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

// Clears only the /tournaments list override, falling back to the main
// (Home) geometry again -- distinct from resetTournamentVisualConfig above,
// which also wipes the main geometry and uploaded asset.
export async function resetTournamentVisualListOverride(
  tournamentType: string,
): Promise<TournamentVisualConfig> {
  if (!isTournamentVisualType(tournamentType)) {
    throw new Error("Неизвестный тип турнира");
  }
  const existing =
    (await getTournamentVisualConfigs()).find((config) => config.tournamentType === tournamentType) ??
    getDefaultTournamentVisual(tournamentType);
  const { tournamentType: type, assetUrl, cardAssetUrl, scale, offsetX, offsetY, opacity } = existing;
  return saveTournamentVisualConfig({
    tournamentType: type,
    assetUrl,
    ...(cardAssetUrl !== undefined ? { cardAssetUrl } : {}),
    scale,
    offsetX,
    offsetY,
    opacity,
  });
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

  // One shared identity for the original and its card derivative -- both
  // filenames are unique per upload (never overwrite a previous upload) and
  // clearly belong together. The derivative is generated in memory FIRST:
  // if resizing throws, nothing is written or persisted at all, and the
  // config in app_settings still points at whatever visual was live before
  // this call -- same guarantee for each subsequent step below (an upload
  // failure or a persistence failure never leaves a half-updated config;
  // an already-written orphan file from a step that succeeded before a
  // later failure is acceptable here, not cleaned up in this task).
  const stem = `${tournamentType}-${Date.now()}-${randomUUID()}`;
  const cardBytes = await createTournamentCardDerivative(bytes);

  const assetUrl = await tournamentAssetStorageRepository.upload(`${stem}.png`, bytes);
  const cardAssetUrl = await tournamentAssetStorageRepository.upload(
    `${stem}-card.png`,
    cardBytes,
  );

  const existing =
    (await getTournamentVisualConfigs()).find((config) => config.tournamentType === tournamentType) ??
    getDefaultTournamentVisual(tournamentType);

  return saveTournamentVisualConfig({ ...existing, assetUrl, cardAssetUrl });
}
