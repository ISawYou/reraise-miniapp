"use client";

import { useState, type ReactNode } from "react";
import { TournamentVisual } from "@/components/tournaments/tournament-visual";
import type { TournamentType } from "@/types/domain";
import type { TournamentVisualConfig } from "@/config/tournament-visuals";
import { getTournamentTypeLabel } from "@/lib/tournament-helpers";

export const PROFILE_SURFACE = {
  card: "rounded-2xl border border-white/10 bg-white/[0.045]",
  highlighted: "rounded-2xl border border-[#d5b867]/25 bg-[linear-gradient(145deg,#17271d_0%,#0d1511_100%)]",
  muted: "rounded-xl border border-white/10 bg-black/20",
  gold: "#d5b867",
} as const;

export function ContentCard({
  children,
  className = "",
  variant = "card",
}: {
  children: ReactNode;
  className?: string;
  variant?: keyof typeof PROFILE_SURFACE;
}) {
  return <div className={`${PROFILE_SURFACE[variant]} ${className}`}>{children}</div>;
}

export function ProfileKpiCell({ label, value, tone = "default" }: { label: string; value: ReactNode; tone?: "default" | "gold" }) {
  return (
    <div className="min-w-0 px-2 py-1 text-center">
      <p className={`truncate text-xl font-semibold tabular-nums ${tone === "gold" ? "text-[#f0d38a]" : "text-white"}`}>{value}</p>
      <p className="mt-1 text-[11px] text-white/60">{label}</p>
    </div>
  );
}

export function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "gold" | "green" }) {
  const toneClass = tone === "gold"
    ? "border-[#d5b867]/35 bg-[#d5b867]/10 text-[#f0d38a]"
    : tone === "green"
      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
      : "border-white/10 bg-white/[0.06] text-white/65";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${toneClass}`}>{children}</span>;
}

export function CompactListRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex min-w-0 items-center gap-3 rounded-xl border border-white/8 bg-white/[0.025] px-3 py-3 ${className}`}>{children}</div>;
}

export function TournamentArtworkIcon({
  tournamentType,
  configs,
}: {
  tournamentType: TournamentType;
  configs: Record<string, TournamentVisualConfig>;
}) {
  const config = configs[tournamentType];
  return <CompactArtwork key={`${tournamentType}|${config?.assetUrl}|${config?.cardAssetUrl}`} tournamentType={tournamentType} configs={configs} />;
}

const TYPE_MARKS: Record<TournamentType, string> = {
  classic: "♠", phoenix: "PH", deep_stack: "DS", bounty: "KO",
  boss_bounty: "BOSS", win_the_button: "BTN", mystery_bounty: "?",
  crazy_pineapple: "CP", bomb_pot: "BP", boost_rating: "↑", free_roll: "FR",
};

function CompactArtwork({ tournamentType, configs }: { tournamentType: TournamentType; configs: Record<string, TournamentVisualConfig> }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div title={getTournamentTypeLabel(tournamentType)} className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[#101b15]">
      {!loaded ? <span data-artwork-fallback={tournamentType} className="text-[11px] font-semibold tracking-wide text-[#d5b867]/75">{TYPE_MARKS[tournamentType]}</span> : null}
      <TournamentVisual
        tournamentType={tournamentType}
        configs={configs}
        className="z-0"
        artworkSizeClassName="absolute inset-0 w-full"
        loading="lazy"
        onLoadStateChange={setLoaded}
      />
    </div>
  );
}
