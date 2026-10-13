import Link from "next/link";
import { ACADEMY_ACCESS_COPY, ACADEMY_MEMBERSHIP_CTA_ROUTE } from "@/config/academy/access-copy";
import { ACADEMY_BEGINNER_ROUTE } from "@/config/academy/navigation-routes";
import { AcademyLockIcon } from "@/components/academy/academy-membership-panel";

const SCREEN_CLASS = "min-h-screen bg-[linear-gradient(180deg,#09100d_0%,#080a09_45%,#070707_100%)] px-4 py-6 pb-28 text-white";

/**
 * Rendered by the SERVER instead of a locked page (never an overlay over the
 * real content — the locked page's data is not part of this response).
 */
export function AcademyLockedScreen() {
  return (
    <main data-academy-locked className={SCREEN_CLASS}>
      <div className="mx-auto flex min-h-[65vh] max-w-md flex-col justify-center">
        <div className="rounded-[24px] border border-white/10 bg-[radial-gradient(ellipse_90%_80%_at_50%_0%,rgba(215,181,90,0.1),transparent_70%),rgba(255,255,255,0.04)] p-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#d7b55a]/15 text-[#d7b55a]">
            <AcademyLockIcon className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">{ACADEMY_ACCESS_COPY.lockedScreenTitle}</h1>
          <p className="mt-2 text-sm leading-6 text-white/65">{ACADEMY_ACCESS_COPY.lockedScreenBody}</p>
          <Link
            href={ACADEMY_MEMBERSHIP_CTA_ROUTE}
            data-academy-locked-cta
            className="mt-5 flex min-h-12 items-center justify-center rounded-2xl bg-[#d7b55a] px-5 py-3 text-base font-semibold text-[#11120f] active:bg-[#e2c66f]"
          >
            {ACADEMY_ACCESS_COPY.cta}
          </Link>
          <Link
            href={ACADEMY_BEGINNER_ROUTE}
            data-academy-locked-back
            className="mt-2.5 flex min-h-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-[15px] font-medium text-white/80 active:bg-white/[0.08]"
          >
            {ACADEMY_ACCESS_COPY.lockedScreenBack}
          </Link>
        </div>
      </div>
    </main>
  );
}

/** Neutral placeholder while the session is not yet established (the client gate restores it, then refreshes). */
export function AcademyAccessPending() {
  return (
    <main data-academy-access-pending className={SCREEN_CLASS}>
      <div className="mx-auto flex min-h-[65vh] max-w-md items-center justify-center">
        <p className="text-sm text-white/45">{ACADEMY_ACCESS_COPY.checking}</p>
      </div>
    </main>
  );
}
