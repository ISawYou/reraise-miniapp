"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import type { Player } from "@/types/domain";

function HomeIcon() {
  return <span aria-hidden="true">🏠</span>;
}

function TournamentsIcon() {
  return <span aria-hidden="true">♠️</span>;
}

function ProfileIcon() {
  return <span aria-hidden="true">👤</span>;
}

function AcademyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5Z" />
      <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5Z" />
    </svg>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const [player, setPlayer] = useState<Player | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPlayer() {
      try {
        const currentPlayer = await resolveCurrentPlayer();

        if (!cancelled) {
          setPlayer(currentPlayer);
        }
      } catch {
        if (!cancelled) {
          setPlayer(null);
        }
      }
    }

    void loadPlayer();

    return () => {
      cancelled = true;
    };
  }, []); // player загружается один раз; pathname реактивен через usePathname()

  if (!player) {
    return null;
  }

  // Admin pages manage their own layout/back-navigation and don't leave
  // room for a fixed bottom bar — it ends up overlapping content instead.
  if (pathname?.startsWith("/admin")) {
    return null;
  }

  const profileHref = `/players/${player.id}`;
  const isHome = pathname === "/";
  const isTournaments = pathname.startsWith("/tournaments");
  const isProfile = pathname === profileHref || pathname.startsWith("/players/");
  const isAcademy = pathname.startsWith("/academy");

  function getItemClass(active: boolean) {
    return active
      ? "flex flex-col items-center justify-center gap-1 rounded-xl bg-white/[0.08] px-2 py-2 text-center text-xs font-medium text-white"
      : "flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center text-xs font-medium text-white/55";
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-[#090909]/95 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 backdrop-blur-xl">
      <div className="mx-auto grid max-w-md grid-cols-4 gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-2">
        <Link href="/" className={getItemClass(isHome)}>
          <HomeIcon />
          <span>Главная</span>
        </Link>

        <Link href="/tournaments" className={getItemClass(isTournaments)}>
          <TournamentsIcon />
          <span>Турниры</span>
        </Link>

        <Link href="/academy" className={getItemClass(isAcademy)}>
          <AcademyIcon />
          <span>Академия</span>
        </Link>

        <Link href={profileHref} className={getItemClass(isProfile)}>
          <ProfileIcon />
          <span>Профиль</span>
        </Link>
      </div>
    </nav>
  );
}
