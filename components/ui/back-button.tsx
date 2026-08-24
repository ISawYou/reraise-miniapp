"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

type BackButtonProps = {
  href?: string;
  fallbackHref?: string;
  historyAware?: boolean;
  label?: string;
  className?: string;
  onClick?: () => void;
};

const BASE_CLASS = "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-2 text-sm font-medium text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl transition hover:bg-white/[0.09] hover:text-white/85 active:scale-[0.97]";

export function BackButton({
  href,
  fallbackHref = "/",
  historyAware = false,
  label = "Назад",
  className = "",
  onClick,
}: BackButtonProps) {
  const router = useRouter();
  const content = <><span aria-hidden="true">←</span><span>{label}</span></>;
  const classes = `${BASE_CLASS} ${className}`.trim();

  if (historyAware || onClick) {
    return (
      <button
        type="button"
        className={classes}
        onClick={() => {
          if (onClick) return onClick();
          if (window.history.length > 1) router.back();
          else router.push(fallbackHref);
        }}
      >
        {content}
      </button>
    );
  }

  return <Link href={href ?? fallbackHref} className={classes}>{content}</Link>;
}
