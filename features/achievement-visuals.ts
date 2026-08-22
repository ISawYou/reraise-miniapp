import { randomUUID } from "crypto";
import {
  ACHIEVEMENT_ASSET_KEYS,
  getDefaultAchievementVisual,
  isAchievementAssetKey,
  type AchievementVisualConfig,
} from "@/config/achievement-visuals";
import {
  achievementAssetStorageRepository,
  achievementVisualRepository,
} from "@/lib/repositories";

const MAX_PNG_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function validateGeometry(config: AchievementVisualConfig): void {
  if (!Number.isInteger(config.scale) || config.scale < 50 || config.scale > 200) {
    throw new Error("Scale должен быть целым числом от 50 до 200");
  }
  for (const [label, value] of [["X offset", config.offsetX], ["Y offset", config.offsetY]] as const) {
    if (!Number.isInteger(value) || value < -100 || value > 100) {
      throw new Error(`${label} должен быть целым числом от -100 до 100`);
    }
  }
}

export async function getAchievementVisualConfigs(): Promise<AchievementVisualConfig[]> {
  const stored = new Map(
    (await achievementVisualRepository.list())
      .filter((config) => isAchievementAssetKey(config.visualKey))
      .map((config) => [config.visualKey, config]),
  );

  return ACHIEVEMENT_ASSET_KEYS.map(
    (visualKey) => stored.get(visualKey) ?? getDefaultAchievementVisual(visualKey),
  );
}

export async function saveAchievementVisualConfig(
  input: AchievementVisualConfig,
): Promise<AchievementVisualConfig> {
  if (!isAchievementAssetKey(input.visualKey)) {
    throw new Error("Неизвестный visual key");
  }
  const config = {
    ...input,
    assetUrl: input.assetUrl.trim(),
  };
  if (!config.assetUrl || (!config.assetUrl.startsWith("/") && !/^https:\/\//.test(config.assetUrl))) {
    throw new Error("Некорректный public asset URL");
  }
  validateGeometry(config);
  await achievementVisualRepository.upsert(config);
  return config;
}

export async function uploadAchievementPng(
  visualKey: string,
  file: File,
): Promise<AchievementVisualConfig> {
  if (!isAchievementAssetKey(visualKey)) {
    throw new Error("Неизвестный visual key");
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

  const fileName = `${visualKey}-${Date.now()}-${randomUUID()}.png`;
  const assetUrl = await achievementAssetStorageRepository.upload(fileName, bytes);
  const existing = (await getAchievementVisualConfigs()).find(
    (config) => config.visualKey === visualKey,
  ) ?? getDefaultAchievementVisual(visualKey);

  return saveAchievementVisualConfig({ ...existing, assetUrl });
}
