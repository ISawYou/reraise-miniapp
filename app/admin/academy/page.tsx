"use client";

import Image from "next/image";
import { BackButton } from "@/components/ui/back-button";
import { useEffect, useState } from "react";
import { fetchAdminJson } from "@/lib/client-request";
import { resolveCurrentPlayer } from "@/lib/current-player";
import type { AcademyAdminProgressPayload } from "@/types/academy";

function formatActivity(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function AdminAcademyPage() {
  const [data, setData] = useState<AcademyAdminProgressPayload | null>(null);
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const player = await resolveCurrentPlayer();
        if (player.role !== "admin") throw new Error("Доступ запрещён");
        setData(await fetchAdminJson<AcademyAdminProgressPayload>("/api/admin/academy"));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить данные");
      }
    }

    void load();
  }, []);

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-3xl">
        <BackButton href="/admin" />
        <h1 className="mt-4 text-2xl font-bold">Академия</h1>

        {error ? <p className="mt-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</p> : null}
        {!data && !error ? <p className="mt-6 text-sm text-white/60">Загрузка...</p> : null}

        {data ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-white/50">Начали обучение</p>
                <p className="mt-1 text-2xl font-semibold">{data.summary.startedPlayers}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-white/50">Прошли ≥1 урок</p>
                <p className="mt-1 text-2xl font-semibold">{data.summary.passedPlayers}</p>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              {data.players.map((entry) => {
                const expanded = expandedPlayerId === entry.player.id;
                return (
                  <section key={entry.player.id} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
                    <button
                      type="button"
                      onClick={() => setExpandedPlayerId(expanded ? null : entry.player.id)}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 text-left"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        {entry.player.avatarUrl ? (
                          <Image src={entry.player.avatarUrl} alt="" width={38} height={38} className="h-9.5 w-9.5 rounded-full object-cover" />
                        ) : (
                          <span className="flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold">
                            {entry.player.displayName.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{entry.player.displayName}</span>
                          <span className="block text-xs text-white/45">{formatActivity(entry.lastActivityAt)}</span>
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block font-semibold text-emerald-300">{entry.passedLessons} из {entry.totalLessons}</span>
                        <span className="text-xs text-white/40">{expanded ? "Свернуть" : "Подробнее"}</span>
                      </span>
                    </button>

                    {expanded ? (
                      <div className="border-t border-white/10 px-3 py-2">
                        {entry.lessons.map((lesson) => (
                          <div key={lesson.lessonCode} className={`flex items-center justify-between gap-3 border-b border-white/5 py-2.5 last:border-0 ${lesson.progress ? "" : "text-white/30"}`}>
                            <span className="min-w-0 truncate text-sm">
                              {lesson.progress?.passed ? "✓ " : ""}{lesson.title}
                            </span>
                            <span className="shrink-0 text-xs tabular-nums">
                              {lesson.progress ? `${lesson.progress.bestScorePercent}% · ${lesson.progress.attemptsCount} попыток` : "Не начат"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </section>
                );
              })}

              {data.players.length === 0 ? (
                <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">Пока никто не начал обучение.</p>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
