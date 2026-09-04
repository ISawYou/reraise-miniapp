import type { AchievementTierLevel, AchievementVisualKey } from "@/config/achievements";
import {
  resolveAchievementAssetUrl,
  type AchievementAssetVariant,
  type AchievementVisualConfig,
} from "@/config/achievement-visuals";

type AchievementVisualProps = {
  visualKey: AchievementVisualKey;
  tier?: AchievementTierLevel | null;
  configs: Record<string, AchievementVisualConfig>;
  locked?: boolean;
  dimmed?: boolean;
  className?: string;
  // "original" (default) renders the admin-configured assetUrl unchanged --
  // every existing call site keeps its current behavior. "thumbnail" is
  // for small icon instances only (currently just Home's ~36px featured
  // achievements); "medium" is for the full Achievements page's larger
  // (~112-176px) grid/detail artwork. Both resolve through
  // resolveAchievementAssetUrl(), which only ever substitutes a
  // pre-generated derivative for a known built-in local asset -- any other
  // URL (external/storage-hosted/unknown) renders the original, never a
  // broken path. See config/achievement-visuals.ts.
  assetVariant?: AchievementAssetVariant;
  // Native browser `loading` attribute, passed through unchanged to both
  // the central and frame <img> elements -- no IntersectionObserver/custom
  // loader. Defaults to "eager" (the previous, unconditional behavior of
  // every existing call site) so nothing changes unless a consumer opts
  // into "lazy" explicitly, which only makes sense for a grid/list where
  // some instances are below the fold.
  loading?: "eager" | "lazy";
};

export function AchievementVisual({
  visualKey,
  tier,
  configs,
  locked = false,
  dimmed = false,
  className = "h-32 w-32",
  assetVariant = "original",
  loading = "eager",
}: AchievementVisualProps) {
  const central = configs[visualKey];
  const frame = tier ? configs[tier] : undefined;

  if (locked) {
    return (
      <div className={`relative grid place-items-center rounded-full border border-white/10 bg-white/[0.04] ${className}`}>
        <span className="text-3xl text-white/25" aria-label="Секретное достижение">?</span>
      </div>
    );
  }

  return (
    <div className={`relative shrink-0 overflow-visible ${className}`}>
      {central ? (
        // Dynamic admin-managed URLs cannot use next/image's static host allow-list.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolveAchievementAssetUrl(central.assetUrl, assetVariant)}
          alt=""
          loading={loading}
          className={`absolute inset-0 h-full w-full object-contain ${dimmed ? "grayscale opacity-40" : ""}`}
          style={{
            transform: `translate(${central.offsetX}%, ${central.offsetY}%) scale(${central.scale / 100})`,
          }}
        />
      ) : null}
      {frame ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolveAchievementAssetUrl(frame.assetUrl, assetVariant)}
          alt=""
          loading={loading}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
        />
      ) : null}
    </div>
  );
}
