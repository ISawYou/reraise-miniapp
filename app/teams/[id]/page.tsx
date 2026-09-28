"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { BackButton } from "@/components/ui/back-button";
import { useEffect, useState } from "react";
import { getPlayerAvatarFallback, getPlayerAvatarUrl } from "@/lib/player-avatar";

type PlayerSafeView = {
  player_id: string;
  display_name: string;
  username: string | null;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
};

type TeamRosterMember = PlayerSafeView & { is_captain: boolean; joined_at: string };
type TeamContributionRow = PlayerSafeView & { points: number; is_current_member: boolean };

type TeamDetailView = {
  id: string;
  name: string;
  emblem: string;
  status: "active" | "disbanded";
  disbanded_at: string | null;
  captain_player_id: string;
  points: number;
  rank: number | null;
  roster: TeamRosterMember[];
  contributions: TeamContributionRow[];
};

function Avatar({ player, className = "h-11 w-11" }: { player: PlayerSafeView; className?: string }) {
  const url = getPlayerAvatarUrl({
    display_name: player.display_name,
    custom_avatar_url: player.custom_avatar_url,
    telegram_avatar_url: player.telegram_avatar_url,
  });
  if (url) {
    return <img src={url} alt={player.display_name} className={`${className} shrink-0 rounded-full border border-white/10 object-cover`} />;
  }
  return (
    <div className={`${className} flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-sm font-semibold text-white/80`}>
      {getPlayerAvatarFallback({ display_name: player.display_name })}
    </div>
  );
}

export default function TeamDetailPage() {
  const params = useParams<{ id: string }>();
  const teamId = params?.id;

  const [team, setTeam] = useState<TeamDetailView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`/api/teams/${teamId}?scope=current`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error ?? "Команда не найдена");
        }
        if (!cancelled) {
          setTeam(payload.team);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить команду");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  return (
    <main className="min-h-screen bg-black px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-md">
        <BackButton historyAware fallbackHref="/teams" className="mb-4" />

        {loading ? (
          <p className="text-sm text-white/50">Загружаем...</p>
        ) : error || !team ? (
          <p className="text-sm text-red-300">{error ?? "Команда не найдена"}</p>
        ) : (
          <>
            <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-4xl">
                  {team.emblem}
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-xl font-black uppercase tracking-wide text-white">{team.name}</h1>
                  <p className="mt-1 text-sm text-white/55">
                    {team.status === "disbanded" ? "Распущена" : `#${team.rank ?? "—"} в рейтинге`} · {team.points}{" "}
                    очков
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-3xl border border-white/10 bg-white/[0.05] p-4">
              <p className="text-sm font-semibold text-white/80">Состав ({team.roster.length} / 5)</p>
              <div className="mt-3 space-y-2">
                {team.roster.length === 0 ? (
                  <p className="text-sm text-white/50">В команде пока нет участников</p>
                ) : (
                  team.roster.map((member) => (
                    <Link
                      key={member.player_id}
                      href={`/players/${member.player_id}`}
                      className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-2.5"
                    >
                      <Avatar player={member} className="h-10 w-10" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{member.display_name}</p>
                        {member.is_captain ? <p className="text-[11px] text-[#d5b867]">👑 Капитан</p> : null}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>

            <div className="mt-5 rounded-3xl border border-white/10 bg-white/[0.05] p-4">
              <p className="text-sm font-semibold text-white/80">Вклад в сезоне</p>
              <div className="mt-3 space-y-2">
                {team.contributions.length === 0 ? (
                  <p className="text-sm text-white/50">Пока нет результатов</p>
                ) : (
                  team.contributions.map((row) => (
                    <Link
                      key={row.player_id}
                      href={`/players/${row.player_id}`}
                      className="flex items-center gap-3"
                    >
                      <Avatar player={row} className="h-9 w-9" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-white/85">{row.display_name}</p>
                        {!row.is_current_member ? <p className="text-[11px] text-white/40">Бывший участник</p> : null}
                      </div>
                      <div className="shrink-0 text-sm font-semibold text-[#d7b55a]">{row.points}</div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
