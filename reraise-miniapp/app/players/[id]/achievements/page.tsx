"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

type AchievementRow = {
  achievement_code: string;
  current_value: number;
  completed_at: string | null;
};

type AchievementView = {
  id: string;
  code: string;
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

function UserIcon() {
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
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

function AwardIcon() {
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
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M9.5 12.5 8 20l4-2 4 2-1.5-7.5" />
    </svg>
  );
}

export default function PlayerAchievementsPage() {
  const params = useParams<{ id: string }>();
  const playerId = params?.id;

  const [loading, setLoading] = useState(true);
  const [achievementProgress, setAchievementProgress] = useState<
    Record<string, { current: number; completed: boolean }>
  >({});

  useEffect(() => {
    async function loadAchievements() {
      if (!playerId) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/players/${playerId}/achievements`);
        if (!res.ok) {
          console.error("[achievements] API error:", res.status, await res.text());
          return;
        }

        const rows: AchievementRow[] = await res.json();

        // DEBUG: remove after verifying achievements display correctly
        console.log("[achievements] player_id:", playerId);
        console.log("[achievements] raw rows from DB:", rows.map((r) => ({
          achievement_code: r.achievement_code,
          current_value: r.current_value,
          completed_at: r.completed_at,
          isCompleted: r.completed_at !== null,
        })));

        setAchievementProgress(
          rows.reduce<Record<string, { current: number; completed: boolean }>>(
            (acc, row) => {
              acc[row.achievement_code] = {
                current: row.current_value,
                completed: row.completed_at !== null,
              };
              return acc;
            },
            {}
          )
        );
      } catch (err) {
        console.error("[achievements] Unexpected error:", err);
      } finally {
        setLoading(false);
      }
    }

    loadAchievements();
  }, [playerId]);

  const ACHIEVEMENT_TARGETS: Record<string, number> = {
    first_tournament: 1,
    ten_tournaments: 10,
    first_win: 1,
    rookie_100_rating: 100,
    pro_1000_rating: 1000,
  };

  const achievements: AchievementView[] = [
    {
      id: "first-tournament",
      code: "first_tournament",
      title: "Дебют",
      description: "Сыграть 1 турнир",
      current: Math.min(achievementProgress.first_tournament?.current ?? 0, 1),
      target: 1,
      icon: <PlayIcon />,
    },
    {
      id: "ten-tournaments",
      code: "ten_tournaments",
      title: "В игре",
      description: "Сыграть 10 турниров",
      current: Math.min(achievementProgress.ten_tournaments?.current ?? 0, 10),
      target: 10,
      icon: <StackIcon />,
    },
    {
      id: "first-win",
      code: "first_win",
      title: "Первая победа",
      description: "Победить в одном турнире",
      current: Math.min(achievementProgress.first_win?.current ?? 0, 1),
      target: 1,
      icon: <TrophyIcon />,
    },
    {
      id: "rookie-rating",
      code: "rookie_100_rating",
      title: "Новичок",
      description: "Набрать 100 очков",
      current: Math.min(achievementProgress.rookie_100_rating?.current ?? 0, 100),
      target: 100,
      icon: <UserIcon />,
    },
    {
      id: "pro-rating",
      code: "pro_1000_rating",
      title: "Профи",
      description: "Набрать 1000 очков",
      current: Math.min(achievementProgress.pro_1000_rating?.current ?? 0, 1000),
      target: 1000,
      icon: <AwardIcon />,
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
        <p className="mt-2 text-sm text-white/45">Текущий прогресс</p>

        <div className="mt-6 space-y-3">
          {loading ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5 text-white/70">
              Загружаем достижения...
            </div>
          ) : (
            achievements.map((achievement) => {
              const dbEntry = achievementProgress[achievement.code];
              const isCompleted = dbEntry?.completed ?? false;
              const progress = Math.min(
                100,
                Math.round((achievement.current / achievement.target) * 100)
              );

              return (
                <div
                  key={achievement.id}
                  className={`rounded-3xl border p-5 transition-colors ${
                    isCompleted
                      ? "border-yellow-500/40 bg-yellow-500/6"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                        isCompleted
                          ? "bg-yellow-500 text-black"
                          : "bg-white/[0.07] text-white/80"
                      }`}
                    >
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

                        {isCompleted ? (
                          <span className="shrink-0 text-xs font-semibold text-yellow-500">
                            Выполнено
                          </span>
                        ) : (
                          <p className="shrink-0 text-sm font-medium text-white/70">
                            {achievement.current}/{achievement.target}
                          </p>
                        )}
                      </div>

                      <div className="mt-4 h-2 rounded-full bg-white/[0.08]">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            isCompleted ? "bg-yellow-500" : "bg-white"
                          }`}
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
