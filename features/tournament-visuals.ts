import { randomUUID } from "crypto";
import {
  TOURNAMENT_VISUAL_TYPES,
  DEFAULT_PROFILE_GEOMETRY,
  getDefaultTournamentVisual,
  isTournamentVisualType,
  type TournamentVisualConfig,
  type TournamentVisualGeometry,
} from "@/config/tournament-visuals";
import { getAppSetting, updateAppSettingObject } from "@/lib/app-settings";
import { InvalidStoredSettingError, storedObject } from "@/lib/app-settings-errors";
import { TournamentVisualValidationError } from "@/lib/tournament-visual-errors";
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

function validateGeometry(input: unknown, surfaceLabel = "", maxScale = 200): TournamentVisualGeometry {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TournamentVisualValidationError("Некорректная геометрия");
  const geometry = input as TournamentVisualGeometry;
  const prefix = surfaceLabel ? `${surfaceLabel}: ` : "";
  if (!Number.isInteger(geometry.scale) || geometry.scale < 50 || geometry.scale > maxScale) {
    throw new TournamentVisualValidationError(`${prefix}Масштаб должен быть целым числом от 50 до ${maxScale}`);
  }
  for (const [label, value] of [["Смещение X", geometry.offsetX], ["Смещение Y", geometry.offsetY]] as const) {
    if (!Number.isInteger(value) || value < -100 || value > 100) {
      throw new TournamentVisualValidationError(`${prefix}${label} должен быть целым числом от -100 до 100`);
    }
  }
  if (!Number.isInteger(geometry.opacity) || geometry.opacity < 0 || geometry.opacity > 100) {
    throw new TournamentVisualValidationError(`${prefix}Непрозрачность должна быть целым числом от 0 до 100`);
  }
  return { scale: geometry.scale, offsetX: geometry.offsetX, offsetY: geometry.offsetY, opacity: geometry.opacity };
}

function requireType(value: unknown): TournamentType {
  if (typeof value !== "string" || !isTournamentVisualType(value)) throw new TournamentVisualValidationError("Неизвестный тип турнира");
  return value;
}

function isValidPublicAssetUrl(value: string): boolean {
  return !!value && (value.startsWith("/") || /^https:\/\//.test(value));
}

// Resolve defaults only in the read model. Never materialize eleven defaults
// back into storage when changing one type. Known malformed data fails closed;
// unknown object fields and future type keys survive all mutations unchanged.
function resolveVisual(raw: Record<string, unknown>, type: TournamentType): TournamentVisualConfig {
  const defaults = getDefaultTournamentVisual(type);
  if (!Object.hasOwn(raw, type)) return defaults;
  try {
    const entry = storedObject(raw[type]);
    if (entry.tournamentType !== undefined && entry.tournamentType !== type) throw new InvalidStoredSettingError();
    const config = { ...defaults, ...entry, tournamentType: type } as TournamentVisualConfig;
    if (entry.assetUrl !== undefined && entry.assetUrl !== defaults.assetUrl && entry.cardAssetUrl === undefined) delete config.cardAssetUrl;
    if (typeof config.assetUrl !== "string" || !isValidPublicAssetUrl(config.assetUrl)) throw new InvalidStoredSettingError();
    if (config.cardAssetUrl !== undefined && (typeof config.cardAssetUrl !== "string" || !isValidPublicAssetUrl(config.cardAssetUrl))) throw new InvalidStoredSettingError();
    validateGeometry(config);
    if (entry.list !== undefined) config.list = { ...storedObject(entry.list), ...validateGeometry({ scale: config.scale, offsetX: config.offsetX, offsetY: config.offsetY, opacity: config.opacity, ...storedObject(entry.list) }) };
    if (entry.profile !== undefined) config.profile = { ...storedObject(entry.profile), ...validateGeometry({ ...DEFAULT_PROFILE_GEOMETRY, ...storedObject(entry.profile) }, "Профиль", 300) };
    return config;
  } catch {
    throw new InvalidStoredSettingError();
  }
}

function visualMap(value: unknown): Record<string, unknown> {
  const raw = value === null ? {} : storedObject(value);
  for (const type of TOURNAMENT_VISUAL_TYPES) resolveVisual(raw, type);
  return raw;
}

export async function getTournamentVisualConfigs(): Promise<TournamentVisualConfig[]> {
  const raw = visualMap(await getAppSetting(APP_SETTINGS_KEY));
  return TOURNAMENT_VISUAL_TYPES.map(type => resolveVisual(raw, type));
}

async function mutateVisual(type: TournamentType, mutate: (latest: Record<string, unknown>) => Record<string, unknown>) {
  const committed = await updateAppSettingObject(APP_SETTINGS_KEY, (current) => {
    const raw = visualMap(current);
    const latest = Object.hasOwn(raw, type) ? storedObject(raw[type]) : { tournamentType: type };
    const next = { ...raw, [type]: mutate(latest) };
    visualMap(next);
    return next;
  });
  return resolveVisual(committed, type);
}

// Explicit surface command: full client snapshots are rejected. Same-surface
// writes use serialized last-writer-wins; different surfaces/types preserve
// each other by applying only these four fields to the latest locked row.
export async function saveTournamentVisualConfig(input: unknown): Promise<TournamentVisualConfig> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TournamentVisualValidationError("Некорректная команда оформления");
  const command = input as { tournamentType?: unknown; surface?: unknown; geometry?: unknown };
  const type = requireType(command.tournamentType);
  if (command.surface !== "main" && command.surface !== "list") throw new TournamentVisualValidationError("Укажите поверхность main или list");
  const geometry = validateGeometry(command.geometry);
  return mutateVisual(type, latest => command.surface === "main" ? { ...latest, ...geometry } : { ...latest, list: { ...(latest.list ? storedObject(latest.list) : {}), ...geometry } });
}

export async function saveTournamentVisualProfileGeometry(
  tournamentType: string,
  input: unknown,
): Promise<TournamentVisualConfig> {
  const type = requireType(tournamentType);
  const profile = validateGeometry(input, "Профиль", 300);
  return mutateVisual(type, latest => ({ ...latest, profile: { ...(latest.profile ? storedObject(latest.profile) : {}), ...profile } }));
}

export async function resetTournamentVisualProfileGeometry(tournamentType: string): Promise<TournamentVisualConfig> {
  return mutateVisual(requireType(tournamentType), latest => { const next = { ...latest }; delete next.profile; return next; });
}

export async function resetTournamentVisualConfig(
  tournamentType: string,
): Promise<TournamentVisualConfig> {
  const type = requireType(tournamentType);
  return mutateVisual(type, latest => {
    const defaults = getDefaultTournamentVisual(type);
    const next = { ...latest, ...defaults };
    delete next.list; // Existing Main reset semantics; Profile stays independent.
    if (!defaults.cardAssetUrl) delete next.cardAssetUrl;
    return next;
  });
}

// Clears only the /tournaments list override, falling back to the main
// (Home) geometry again -- distinct from resetTournamentVisualConfig above,
// which also wipes the main geometry and uploaded asset.
export async function resetTournamentVisualListOverride(
  tournamentType: string,
): Promise<TournamentVisualConfig> {
  return mutateVisual(requireType(tournamentType), latest => { const next = { ...latest }; delete next.list; return next; });
}

export async function uploadTournamentVisualPng(
  tournamentType: string,
  file: File,
): Promise<TournamentVisualConfig> {
  const type = requireType(tournamentType);
  if (file.type !== "image/png") {
    throw new TournamentVisualValidationError("Разрешены только PNG-файлы");
  }
  if (file.size < PNG_SIGNATURE.length || file.size > MAX_PNG_BYTES) {
    throw new TournamentVisualValidationError("Размер PNG должен быть от 8 байт до 5 МБ");
  }

  const bytes = await file.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, PNG_SIGNATURE.length);
  if (!PNG_SIGNATURE.every((byte, index) => signature[index] === byte)) {
    throw new TournamentVisualValidationError("Файл не является корректным PNG");
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

  if (!isValidPublicAssetUrl(assetUrl) || !isValidPublicAssetUrl(cardAssetUrl)) throw new Error("Asset storage returned an invalid URL");
  return mutateVisual(type, latest => ({ ...latest, assetUrl, cardAssetUrl }));
}
