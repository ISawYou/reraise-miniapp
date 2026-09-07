import { useState } from "react";
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

// The /tournaments list card's own box: smaller than the default, and
// stops above the bottom occupancy bar (bottom-12) instead of spanning the
// full card height -- a tall/portrait artwork (e.g. Boss Bounty) must never
// render into that strip. Exported so the admin visuals editor's list-mode
// preview uses this exact same box, not a hand-copied duplicate that could
// drift from the real list card.
export const LIST_ARTWORK_SIZE_CLASSNAME =
  "absolute right-0 top-0 bottom-12 w-[50%] sm:w-[44%]";

// The visible artwork used to get its size from object-contain fitting a 1:1
// image into the box above -- effectively HEIGHT-driven, since that box is
// almost the full card height and is usually wider than it is tall. Real
// device snapshots proved this: two real cards with nearly identical
// heights (~197px vs ~198px) but a ~30px difference in WIDTH (379px vs
// 408px) both painted essentially the same absolute-pixel square, so it
// visually crowded the narrower one.
//
// The fix makes the base (unscaled) square a fixed percentage of the BOX'S
// WIDTH instead, chosen to reproduce the last known-correct wider-card
// square: a 196px square on a 408px-wide card is ~48% of the card's width,
// and since the box itself is a fixed 68% of the card, that's 48/68 ≈
// 70.588% of the box. Expressing it relative to the box (not the card
// directly) means any surface that passes its own artworkSizeClassName --
// e.g. the narrower /tournaments dense-list override -- gets a
// proportionally smaller artwork automatically, with no separate tuning
// constant per surface.
export const ARTWORK_STAGE_WIDTH_PERCENT_OF_CARD = 48;
export const OUTER_BOX_WIDTH_PERCENT_OF_CARD = 68;
export const ARTWORK_STAGE_WIDTH_PERCENT_OF_BOX =
  (ARTWORK_STAGE_WIDTH_PERCENT_OF_CARD / OUTER_BOX_WIDTH_PERCENT_OF_CARD) * 100;

type TournamentVisualProps = {
  tournamentType: TournamentType;
  configs: Record<string, TournamentVisualConfig>;
  className?: string;
  // Overrides the mask/fade box's own size/position classes -- controls
  // where the left-edge fade happens and how much vertical room the artwork
  // can use. Every existing surface (Home, tournament detail, Profile
  // upcoming, admin preview) keeps the default by simply not passing this --
  // only the /tournaments list (denser card, needs the artwork moderately
  // smaller) sets it explicitly. The artwork's own size is always
  // ARTWORK_STAGE_WIDTH_PERCENT_OF_BOX of *this* box, so a narrower override
  // still gets a proportionally smaller artwork, not a differently-shaped one.
  artworkSizeClassName?: string;
  // "list" reads config.list (scale/offsetX/offsetY/opacity) when present,
  // falling back to the main geometry when a type has no list override yet
  // -- so /tournaments renders identically to before until an admin
  // explicitly tunes it. assetUrl is always the shared main PNG; only
  // positioning/opacity differ per surface.
  variant?: "default" | "list";
  // Native browser `loading` attribute, passed straight through to the
  // <img>. Default "eager" preserves every existing call site's current
  // behavior unchanged. Home's carousel is the only caller that ever
  // passes "lazy" (for off-screen slides) -- see TournamentCard's
  // artworkLoading prop. No IntersectionObserver, no next/image.
  loading?: "eager" | "lazy";
};

// Decorative artwork layer shared by the Home tournament card and the admin
// preview -- both must render a config identically, so geometry math lives
// here exactly once.
export function TournamentVisual({
  tournamentType,
  configs,
  className = "",
  artworkSizeClassName = DEFAULT_ARTWORK_SIZE_CLASSNAME,
  variant = "default",
  loading = "eager",
}: TournamentVisualProps) {
  const config = configs[tournamentType];

  if (!config) {
    return null;
  }

  const geometry = variant === "list" && config.list ? config.list : config;

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
    variant,
    scale: geometry.scale,
    offsetX: geometry.offsetX,
    offsetY: geometry.offsetY,
    opacity: geometry.opacity,
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
          opacity: geometry.opacity / 100,
          maskImage,
          WebkitMaskImage: maskImage,
        }}
      >
        {/* Offset layer: carries ONLY the admin-managed translate, sized to
            exactly fill the box above -- the same footprint the <img> used
            to have, so offsetX/offsetY% resolve against the same pixel
            dimensions as before and none of the saved configs need
            retuning. */}
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${geometry.offsetX}%, ${geometry.offsetY}%)`,
          }}
        >
          {/* Width-driven artwork stage: a deterministic square sized off
              the box's own WIDTH (see ARTWORK_STAGE_WIDTH_PERCENT_OF_BOX
              above), not the box's height -- this is the actual fix. Admin
              scale is applied here rather than on the <img>, so the
              sizing-critical transform never lands on the replaced element
              itself. */}
          <div
            data-tournament-visual-stage=""
            className="absolute right-0 top-1/2 aspect-square"
            style={{
              width: `${ARTWORK_STAGE_WIDTH_PERCENT_OF_BOX}%`,
              transform: `translateY(-50%) scale(${geometry.scale / 100})`,
              transformOrigin: "center",
            }}
          >
            <TournamentArtworkImage
              // Keyed here (not on the <img> inside) so the WHOLE component
              // -- including its derivative->original fallback state --
              // remounts fresh whenever either URL changes (new upload,
              // reset, or a different tournament type selected). Keying
              // only the <img> would remount that DOM node but silently
              // keep the OLD useOriginal state on the surrounding
              // component's fiber, since the <img>'s key change alone
              // doesn't reset its parent's hooks.
              key={`${config.assetUrl}|${config.cardAssetUrl ?? ""}`}
              assetUrl={config.assetUrl}
              cardAssetUrl={config.cardAssetUrl}
              loading={loading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

type TournamentArtworkImageProps = {
  assetUrl: string;
  cardAssetUrl?: string;
  loading: "eager" | "lazy";
};

// Prefers the smaller 512px card derivative (same artwork as assetUrl, see
// TournamentVisualConfig.cardAssetUrl) and falls back to the full original
// exactly once if the derivative fails to load. Keyed by BOTH URLs from the
// parent (see below) so a new original/card pair from a fresh upload always
// starts this retry state clean -- never inherits a stale fallback from a
// previous config's failed load.
function TournamentArtworkImage({ assetUrl, cardAssetUrl, loading }: TournamentArtworkImageProps) {
  // Nothing to retry into if there's no distinct derivative -- either it
  // was never generated (old/legacy config) or it happens to equal the
  // original byte-for-byte (pathological but harmless: treat it as "no
  // derivative" so a single failure can't trigger a pointless same-URL
  // retry loop).
  const hasDistinctCard = !!cardAssetUrl && cardAssetUrl !== assetUrl;
  const [useOriginal, setUseOriginal] = useState(false);
  const src = hasDistinctCard && !useOriginal ? cardAssetUrl : assetUrl;

  return (
    // Admin-managed URLs (local storage or absolute) cannot use next/image's static host allow-list.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-tournament-visual-img=""
      src={src}
      alt=""
      loading={loading}
      className="h-full w-full object-contain object-right"
      onError={(event) => {
        if (hasDistinctCard && !useOriginal) {
          // First failure was the card derivative -- retry once with the
          // original. If the original then ALSO fails, this handler fires
          // again, but useOriginal is already true, so the branch below
          // runs instead of retrying forever.
          setUseOriginal(true);
          return;
        }
        // Either there was nothing to fall back to, or the fallback
        // (original) itself just failed -- plain card, no broken-image
        // glyph, same behavior as before this derivative existed.
        event.currentTarget.style.display = "none";
      }}
    />
  );
}
