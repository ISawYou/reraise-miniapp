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
  }, [pathname]);

  if (!player) {
    return null;
  }

  const profileHref = `/players/${player.id}`;
  const isHome = pathname === "/";
  const isTournaments = pathname.startsWith("/tournaments");
  const isProfile = pathname === profileHref || pathname.startsWith("/players/");

  function getItemClass(active: boolean) {
    return active
      ? "flex flex-col items-center justify-center gap-1 rounded-xl bg-white/[0.08] px-3 py-2 text-center text-xs font-medium text-white"
      : "flex flex-col items-center justify-center gap-1 rounded-xl px-3 py-2 text-center text-xs font-medium text-white/55";
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-[#090909]/95 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 backdrop-blur-xl">
      <div className="mx-auto grid max-w-md grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2">
        <Link href="/" className={getItemClass(isHome)}>
          <HomeIcon />
          <span>Главная</span>
        </Link>

        <Link href="/tournaments" className={getItemClass(isTournaments)}>
          <TournamentsIcon />
          <span>Турниры</span>
        </Link>

        <Link href={profileHref} className={getItemClass(isProfile)}>
          <ProfileIcon />
          <span>Профиль</span>
        </Link>
      </div>
    </nav>
  );
}
