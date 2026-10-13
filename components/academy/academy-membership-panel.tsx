import Link from "next/link";
import { ACADEMY_ACCESS_COPY, ACADEMY_MEMBERSHIP_CTA_ROUTE } from "@/config/academy/access-copy";

/** Small lock glyph (decorative; the surrounding copy carries the meaning). */
export function AcademyLockIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7" />
    </svg>
  );
}

/**
 * Conversion panel for BEGINNER_ONLY players: the deeper Academy is part of
 * being a club player this season. Presentation only — access itself is
 * enforced on the server (features/academy-access.ts).
 */
export function AcademyMembershipPanel({ className = "" }: { className?: string }) {
  return (
    <section
      id="academy-membership"
      data-academy-membership
      aria-labelledby="academy-membership-title"
      className={`scroll-mt-4 rounded-[24px] border border-[#d7b55a]/25 bg-[radial-gradient(ellipse_90%_80%_at_100%_0%,rgba(215,181,90,0.12),transparent_70%),rgba(255,255,255,0.035)] p-5 ${className}`}
    >
      <h2 id="academy-membership-title" className="text-lg font-semibold leading-6 text-white">
        {ACADEMY_ACCESS_COPY.panelTitle}
      </h2>
      {ACADEMY_ACCESS_COPY.panelBody.map((paragraph) => (
        <p key={paragraph} className="mt-2 text-sm leading-6 text-white/65">{paragraph}</p>
      ))}
      <Link
        href={ACADEMY_MEMBERSHIP_CTA_ROUTE}
        data-academy-membership-cta
        className="mt-4 flex min-h-12 items-center justify-center rounded-2xl bg-[#d7b55a] px-5 py-3 text-base font-semibold text-[#11120f] active:bg-[#e2c66f]"
      >
        {ACADEMY_ACCESS_COPY.cta}
      </Link>
    </section>
  );
}
