import type { TournamentVisualConfig } from "@/config/tournament-visuals";
import type { TournamentType } from "@/types/domain";

// Card-relative, not viewport-relative: this box's own containing block is
// already the (relatively positioned) tournament card, so its width scales
// deterministically with the card regardless of window width. A `sm:`
// variant here would key off the *browser viewport* instead -- on any real
// phone (all portrait widths stay well under Tailwind's 640px `sm` breakpoint)
// it never fires, so live cards always got 68%; but the admin preview card
// (rendered inside a wide desktop browser, itself capped at 280px) crossed
// that viewport threshold and silently previewed a different, narrower 58%
// box than what every phone actually showed. One deterministic value keeps
// admin preview and live rendering in sync everywhere at any device width.
const DEFAULT_ARTWORK_SIZE_CLASSNAME = "absolute inset-y-0 right-0 w-[68%]";

type TournamentVisualProps = {
  tournamentType: TournamentType;
  configs: Record<string, TournamentVisualConfig>;
  className?: string;
  // Overrides the artwork box's own size/position classes. Every existing
  // surface (Home, tournament detail, Profile upcoming, admin preview) keeps
  // the default by simply not passing this -- only the /tournaments list
  // (denser card, needs the artwork moderately smaller) sets it explicitly.
  artworkSizeClassName?: string;
};

// Decorative artwork layer shared by the Home tournament card and the admin
// preview -- both must render a config identically, so geometry math lives
// here exactly once.
export function TournamentVisual({
  tournamentType,
  configs,
  className = "",
  artworkSizeClassName = DEFAULT_ARTWORK_SIZE_CLASSNAME,
}: TournamentVisualProps) {
  const config = configs[tournamentType];

  if (!config) {
    return null;
  }

  // The card's own background must stay exactly as it was before artwork
  // existed -- no full-card overlay here. Legibility instead comes from
  // fading the artwork itself out on its left edge (mask-image), which
  // disappears along with the artwork when there's nothing to mask.
  const maskImage = "linear-gradient(to right, transparent, black 40%)";

  // Plain data attributes, not React state -- the debug overlay reads these
  // straight off the DOM (it has no access to whatever page happens to be
  // rendering this component), so the config values it reports are always
  // exactly what actually produced the geometry on screen.
  const debugConfig = JSON.stringify({
    assetUrl: config.assetUrl,
    scale: config.scale,
    offsetX: config.offsetX,
    offsetY: config.offsetY,
    opacity: config.opacity,
  });

  return (
    <div
      aria-hidden="true"
      data-tournament-visual-root=""
      data-tournament-type={tournamentType}
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      <div
        data-tournament-visual-box=""
        data-config={debugConfig}
        className={artworkSizeClassName}
        style={{
          opacity: config.opacity / 100,
          maskImage,
          WebkitMaskImage: maskImage,
        }}
      >
        {/* Admin-managed URLs (local storage or absolute) cannot use next/image's static host allow-list. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          // Remounts whenever the asset URL changes (new upload, reset, or a
          // different tournament type selected) so a stale `display: none`
          // left behind by a previous failed load never survives onto an
          // image that would actually load fine now.
          key={config.assetUrl}
          data-tournament-visual-img=""
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
    </div>
  );
}
