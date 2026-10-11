import {
  ACADEMY_PUSH_FOLD_ATTRIBUTION_URL,
  ACADEMY_PUSH_FOLD_LICENSE_URL,
} from "@/config/academy/push-fold-trainer";

/**
 * CC BY 4.0 attribution of the HoldemMath push/fold data — a license
 * obligation, rendered on every player-facing Push/Fold screen. Deliberately
 * small and secondary, but always present and always linking to holdemmath.com.
 */
export function PushFoldAttribution({ className = "" }: { className?: string }) {
  return (
    <p
      data-testid="push-fold-attribution"
      className={`text-center text-[11px] leading-5 text-white/40 ${className}`.trim()}
    >
      Данные Push/Fold:{" "}
      <a
        href={ACADEMY_PUSH_FOLD_ATTRIBUTION_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-white/55 underline decoration-white/25 underline-offset-2"
      >
        HoldemMath
      </a>
      {" · "}
      <a
        href={ACADEMY_PUSH_FOLD_LICENSE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-white/55 underline decoration-white/25 underline-offset-2"
      >
        CC BY 4.0
      </a>
    </p>
  );
}
