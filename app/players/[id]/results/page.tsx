"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BackButton } from "@/components/ui/back-button";
import { ProfileResultRow } from "@/components/profile/profile-result-row";
import { fetchTournamentVisualConfigs } from "@/lib/tournament-visuals-client";
import type { ProfileResultsPage } from "@/features/profile-v2";
import type { TournamentVisualConfig } from "@/config/tournament-visuals";

export default function PlayerResultsPage() {
  const { id } = useParams<{ id: string }>();
  // Keying the list cancels/reset its state when navigating between players.
  return <ResultsList key={id} playerId={id} />;
}

function ResultsList({ playerId }: { playerId: string }) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ProfileResultsPage | null>(null);
  const [configs, setConfigs] = useState<Record<string, TournamentVisualConfig>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/players/${playerId}/results?offset=${page}`).then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить результаты");
        return response.json() as Promise<ProfileResultsPage>;
      }),
      fetchTournamentVisualConfigs(),
    ]).then(([next, visuals]) => {
      if (cancelled) return;
      setData(next);
      setConfigs(visuals);
      window.scrollTo({ top: 0, behavior: "instant" });
    }).catch(() => {
      if (!cancelled) setError("Не удалось загрузить результаты");
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [playerId, page, retry]);

  function changePage(offset: number) {
    setBusy(true);
    setError(null);
    setPage(offset);
  }

  return (
    <main className="min-h-screen bg-[#09100d] px-4 py-6 pb-[calc(env(safe-area-inset-bottom)+128px)] text-white">
      <div className="mx-auto max-w-3xl">
        <BackButton href={`/players/${data?.player.id ?? playerId}`} label="К профилю" />
        <h1 className="mt-6 text-2xl font-bold">Все результаты</h1>
        {data ? <p className="mt-1 break-words text-sm text-white/65">{data.player.display_name}</p> : null}
        {error ? (
          <div className="mt-6 text-sm text-white/75" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => { setBusy(true); setError(null); setRetry((value) => value + 1); }} className="mt-2 min-h-11 text-[#d5b867]">Повторить</button>
          </div>
        ) : busy ? <p className="mt-6 text-sm text-white/65" role="status">Загружаем результаты...</p> : (
          <>
            <div className="mt-6 space-y-2">
              {data?.items.map((item) => <ProfileResultRow key={item.tournament.id} item={item} configs={configs} />)}
              {data?.items.length === 0 ? <p className="py-4 text-sm text-white/65">Пока нет завершённых турниров</p> : null}
            </div>
            <div className="mt-5 flex items-center justify-between gap-3">
              <button type="button" disabled={page === 0} onClick={() => changePage(Math.max(0, page - 20))} className="min-h-11 rounded-full border border-white/15 px-4 text-sm disabled:opacity-30">← Назад</button>
              <span className="text-xs text-white/60">Страница {page / 20 + 1}</span>
              <button type="button" disabled={data?.next_offset == null} onClick={() => { if (data?.next_offset != null) changePage(data.next_offset); }} className="min-h-11 rounded-full border border-white/15 px-4 text-sm disabled:opacity-30">Далее →</button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
