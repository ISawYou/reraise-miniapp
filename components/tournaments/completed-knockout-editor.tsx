"use client";

import { useState } from "react";
import { fetchAdminJson } from "@/lib/client-request";
import { isKnockoutCount, POSTGRES_INTEGER_MAX, type CompletedKnockoutResponse, type CompletedKnockoutSnapshot } from "@/lib/completed-knockout-correction";

export function CompletedKnockoutEditor({ tournamentId, playerId, onSaved }: {
  tournamentId: string;
  playerId: string;
  onSaved: (response: CompletedKnockoutResponse) => void;
}) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<CompletedKnockoutSnapshot | null>(null);
  const [ko, setKo] = useState("");
  const [boss, setBoss] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `/api/admin/tournaments/${tournamentId}/completed-knockout-correction`;
  const count = (value: string) => /^\d+$/.test(value) ? Number(value) : NaN;
  const koValue = count(ko), bossValue = count(boss);
  const preview = snapshot ? snapshot.rating_points + (koValue - snapshot.knockouts) * snapshot.points_per_ko + (bossValue - snapshot.boss_knockouts) * snapshot.points_per_boss_ko : NaN;
  const valid = snapshot && isKnockoutCount(koValue) && isKnockoutCount(bossValue) && Number.isInteger(preview) && preview >= 0 && preview <= POSTGRES_INTEGER_MAX;
  const changed = snapshot && (snapshot.knockouts !== koValue || snapshot.boss_knockouts !== bossValue);
  async function start() {
    setOpen(true); setBusy(true); setError(null); setSnapshot(null);
    try {
      const payload = await fetchAdminJson<{ result: CompletedKnockoutSnapshot }>(`${endpoint}?player_id=${encodeURIComponent(playerId)}`);
      setSnapshot(payload.result); setKo(String(payload.result.knockouts)); setBoss(String(payload.result.boss_knockouts));
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось загрузить результат"); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!valid || !snapshot || busy || !changed) return;
    setBusy(true); setError(null);
    try {
      const response = await fetchAdminJson<CompletedKnockoutResponse>(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ player_id: playerId, knockouts: koValue, boss_knockouts: bossValue, revision: snapshot.revision }) });
      onSaved(response); setOpen(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось сохранить KO"); }
    finally { setBusy(false); }
  }
  if (!open) return <button type="button" onClick={() => void start()} aria-label="Исправить KO" className="ml-1 inline-flex min-h-9 items-center rounded-lg border border-white/10 px-2 text-xs text-white/70">✎ KO</button>;
  return <form aria-label="Исправление KO" className="mt-2 w-full space-y-2 border-t border-white/10 pt-3 text-xs" onSubmit={event => { event.preventDefault(); void save(); }}>
    {busy && !snapshot ? <p className="text-white/60">Загрузка результата…</p> : null}
    {snapshot ? <>
      <div className="flex flex-wrap gap-3">
        <label className="space-y-1"><span className="block">KO</span><input aria-label="KO" type="number" inputMode="numeric" min="0" step="1" value={ko} disabled={busy} onChange={e => setKo(e.target.value)} className="min-h-10 w-24 rounded-lg border border-white/15 bg-black/25 px-3 text-base text-white" /></label>
        {snapshot.has_boss_ko ? <label className="space-y-1"><span className="block">Boss KO</span><input aria-label="Boss KO" type="number" inputMode="numeric" min="0" step="1" value={boss} disabled={busy} onChange={e => setBoss(e.target.value)} className="min-h-10 w-24 rounded-lg border border-white/15 bg-black/25 px-3 text-base text-white" /></label> : null}
      </div>
      <p aria-live="polite" className="text-white/75">{valid ? `Рейтинг: ${snapshot.rating_points} → ${preview} (${preview - snapshot.rating_points >= 0 ? "+" : ""}${preview - snapshot.rating_points})` : "Введите целые неотрицательные KO в допустимом диапазоне"}</p>
    </> : null}
    {error ? <p role="alert" className="text-red-300">{error}</p> : null}
    <div className="flex gap-2">
      <button type="button" disabled={busy} onClick={() => setOpen(false)} className="min-h-10 rounded-lg border border-white/15 px-3 text-white/75 disabled:opacity-40">Отмена</button>
      <button type="submit" disabled={busy || !valid || !changed} className="min-h-10 rounded-lg border border-[#d5b867]/35 px-3 text-[#f0d38a] disabled:opacity-40">{busy && snapshot ? "Сохраняем…" : "Сохранить"}</button>
    </div>
  </form>;
}
