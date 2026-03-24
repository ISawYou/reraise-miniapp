"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  getPlayedTournamentsCount,
  getPlayerTournamentHistory,
} from "@/features/tournaments";

type AchievementView = {
  id: string;
  title: string;
  description: string;
  current: number;
  target: number;
  icon: ReactNode;
};

function PlayIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="m10 8.75 5 3.25-5 3.25Z" />
    </svg>
  );
}

function StackIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4 4 8l8 4 8-4-8-4Z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 16 8 4 8-4" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 4.5h8v3.75a4 4 0 0 1-8 0Z" />
      <path d="M10 16.5h4" />
      <path d="M12 12.25v4.25" />
      <path d="M6 6H4.75A1.75 1.75 0 0 0 3 7.75v.5A3.75 3.75 0 0 0 6.75 12H8" />
      <path d="M18 6h1.25A1.75 1.75 0 0 1 21 7.75v.5A3.75 3.75 0 0 1 17.25 12H16" />
      <path d="M9 20h6" />
    </svg>
  );
}

export default function PlayerAchievementsPage() {
  const params = useParams<{ id: string }>();
  const playerId = params?.id;

  const [loading, setLoading] = useState(true);
  const [playedCount, setPlayedCount] = useState(0);
  const [winsCount, setWinsCount] = useState(0);

  useEffect(() => {
    async function loadAchievements() {
      if (!playerId) {
        setLoading(false);
        return;
      }

      try {
        const [played, history] = await Promise.all([
          getPlayedTournamentsCount(playerId),
          getPlayerTournamentHistory(playerId),
        ]);

        setPlayedCount(played);
        setWinsCount(history.filter((item) => item.result.place === 1).length);
      } finally {
        setLoading(false);
      }
    }

    loadAchievements();
  }, [playerId]);

  const achievements: AchievementView[] = [
    {
      id: "first-tournament",
      title: "Дебют",
      description: "Сыграть 1 турнир",
      current: Math.min(playedCount, 1),
      target: 1,
      icon: <PlayIcon />,
    },
    {
      id: "ten-tournaments",
      title: "В игре",
      description: "Сыграть 10 турниров",
      current: Math.min(playedCount, 10),
      target: 10,
      icon: <StackIcon />,
    },
    {
      id: "first-win",
      title: "Первая победа",
      description: "Победить в одном турнире",
      current: Math.min(winsCount, 1),
      target: 1,
      icon: <TrophyIcon />,
    },
  ];

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-md">
        <Link
          href={playerId ? `/players/${playerId}` : "/"}
          className="inline-flex items-center rounded-full border border-white/[0.08] bg-transparent px-3.5 py-2 text-sm text-white/65"
        >
          ← Назад
        </Link>

        <h1 className="mt-6 text-3xl font-bold tracking-tight">Достижения</h1>
        <p className="mt-2 text-sm text-white/45">
          Текущий прогресс
        </p>

        <div className="mt-6 space-y-3">
          {loading ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5 text-white/70">
              Загружаем достижения...
            </div>
          ) : (
            achievements.map((achievement) => {
              const progress = Math.min(
                100,
                Math.round((achievement.current / achievement.target) * 100)
              );

              return (
                <div
                  key={achievement.id}
                  className="rounded-3xl border border-white/10 bg-white/[0.05] p-5"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-white/80">
                      {achievement.icon}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-xl font-semibold text-white">
                            {achievement.title}
                          </h2>
                          <p className="mt-1 text-sm text-white/55">
                            {achievement.description}
                          </p>
                        </div>

                        <p className="text-sm font-medium text-white/70">
                          {achievement.current}/{achievement.target}
                        </p>
                      </div>

                      <div className="mt-4 h-2 rounded-full bg-white/[0.08]">
                        <div
                          className="h-2 rounded-full bg-white"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}
