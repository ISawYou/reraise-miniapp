import type { AchievementTierLevel, AchievementVisualKey } from "@/config/achievements";
import type { AchievementVisualConfig } from "@/config/achievement-visuals";

type AchievementVisualProps = {
  visualKey: AchievementVisualKey;
  tier?: AchievementTierLevel | null;
  configs: Record<string, AchievementVisualConfig>;
  locked?: boolean;
  className?: string;
};

export function AchievementVisual({
  visualKey,
  tier,
  configs,
  locked = false,
  className = "h-32 w-32",
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
          src={central.assetUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-contain"
          style={{
            transform: `translate(${central.offsetX}%, ${central.offsetY}%) scale(${central.scale / 100})`,
          }}
        />
      ) : null}
      {frame ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={frame.assetUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
      ) : null}
    </div>
  );
}
