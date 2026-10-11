import Link from "next/link";
import type { ReactNode } from "react";
import { BackButton } from "@/components/ui/back-button";

/** Back link + eyebrow + title + one plain-language line, shared by the Academy destination pages. */
export function AcademyPageHeader({
  backHref,
  backLabel,
  eyebrow,
  title,
  children,
}: {
  backHref: string;
  backLabel?: string;
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header>
      <BackButton href={backHref} label={backLabel} />
      <p className="mt-7 text-xs font-semibold uppercase tracking-[0.18em] text-[#d7b55a]">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">{title}</h1>
      {children ? <div className="mt-3 text-sm leading-6 text-white/60">{children}</div> : null}
    </header>
  );
}

/** "Что дальше" link card used at the bottom of the learning levels. */
export function AcademyNextStepLink({ href, eyebrow, title, testId }: { href: string; eyebrow: string; title: string; testId?: string }) {
  return (
    <Link
      href={href}
      data-next-step={testId}
      className="mt-3 flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 py-3.5 active:bg-white/[0.06]"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">{eyebrow}</span>
        <span className="mt-0.5 block text-[15px] font-medium text-white/85">{title}</span>
      </span>
      <span aria-hidden="true" className="text-lg text-white/35">→</span>
    </Link>
  );
}
