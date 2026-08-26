import type { TournamentVisualConfig } from "@/config/tournament-visuals";
import type { TournamentType } from "@/types/domain";

type TournamentVisualProps = {
  tournamentType: TournamentType;
  configs: Record<string, TournamentVisualConfig>;
  className?: string;
};

// Decorative artwork layer shared by the Home tournament card and the admin
// preview -- both must render a config identically, so geometry math lives
// here exactly once.
export function TournamentVisual({ tournamentType, configs, className = "" }: TournamentVisualProps) {
  const config = configs[tournamentType];

  if (!config) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      <div
        className="absolute inset-y-0 right-0 w-[68%] sm:w-[58%]"
        style={{ opacity: config.opacity / 100 }}
      >
        {/* Admin-managed URLs (local storage or absolute) cannot use next/image's static host allow-list. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={config.assetUrl}
          alt=""
          className="h-full w-full object-contain object-right"
          style={{
            transform: `translate(${config.offsetX}%, ${config.offsetY}%) scale(${config.scale / 100})`,
          }}
          // A tournament type with no artwork uploaded yet (or a config
          // pointing at a since-deleted file) must fall back to the plain
          // card, not a broken-image glyph.
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-[#0b1210] via-[#0b1210]/45 to-transparent" />
    </div>
  );
}
