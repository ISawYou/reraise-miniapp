"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import type { Player } from "@/types/domain";

function HomeIcon() {
  return <NavIcon><path d="m3 11 9-8 9 8" /><path d="M5.5 9.5V21h13V9.5" /><path d="M9.5 21v-6h5v6" /></NavIcon>;
}

function TournamentsIcon() {
  return <NavIcon><path d="M12 3C9.5 6 5 8.5 5 13a4 4 0 0 0 7 2.6A4 4 0 0 0 19 13c0-4.5-4.5-7-7-10Z" /><path d="M12 15v6" /><path d="M9 21h6" /></NavIcon>;
}

function ProfileIcon() {
  return <NavIcon><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></NavIcon>;
}

function NavIcon({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}

function AcademyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
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
      ? "flex flex-col items-center justify-center gap-1 rounded-2xl border border-white/10 bg-white/[0.12] px-2 py-2 text-center text-[11px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
      : "flex flex-col items-center justify-center gap-1 rounded-2xl border border-transparent px-2 py-2 text-center text-[11px] font-medium text-white/55";
  }

  return (
    <nav className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+10px)] z-30 mx-auto max-w-md rounded-[26px] border border-white/[0.14] bg-[#111713]/90 p-1.5 shadow-[0_14px_40px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] supports-[backdrop-filter]:bg-[#111713]/70 supports-[backdrop-filter]:backdrop-blur-2xl">
      <div className="grid grid-cols-4 gap-1">
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
