"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClubActivityCard } from "@/components/club-activity-card";
import type { ClubActivityEvent } from "@/types/club-activity";

export default function ActivityPage() {
  const [events, setEvents] = useState<ClubActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/club-activity?limit=50")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Не удалось загрузить ленту");
        setEvents(payload.events ?? []);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-[#080808] px-4 py-6 pb-32 text-white">
      <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,#c9a84c12,transparent)]" />
      <div className="relative mx-auto max-w-md">
        <Link href="/" className="telegram-top-action inline-flex text-sm text-white/55">← Назад</Link>
        <h1 className="mt-5 text-2xl font-bold">В клубе</h1>

        {loading ? <p className="mt-6 text-sm text-white/40">Загружаем события...</p> : null}
        {error ? <p className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</p> : null}
        {!loading && !error && events.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/50">
            Здесь скоро появятся новости клуба.
          </p>
        ) : null}
        <div className="mt-5 space-y-3">
          {events.map((event) => (
            <ClubActivityCard key={event.id} event={event} showDetailLink />
          ))}
        </div>
      </div>
    </main>
  );
}
