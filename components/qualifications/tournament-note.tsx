"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { KALININGRAD_EVENT } from "@/lib/qualification-config";
import type { QualificationPublicModel } from "@/types/qualifications";
let cached: { until: number; request: Promise<QualificationPublicModel | null> } | undefined;
function currentEvent() {
  if (!cached || cached.until < Date.now()) cached = { until: Date.now() + 30_000, request: fetch(`/api/qualifications/${KALININGRAD_EVENT.slug}`).then(r => r.ok ? r.json() as Promise<QualificationPublicModel> : null).catch(() => null) };
  return cached.request;
}
// Public read model only. No invitation statuses, private actor or second ranking.
export function QualificationTournamentNote({ tournamentId, compact = false, presentation = "detail" }: { tournamentId: string; compact?: boolean; presentation?: "home" | "detail" }) {
  const [model, setModel] = useState<QualificationPublicModel | null>(null);
  useEffect(() => { let live = true; void currentEvent().then(m => { if (live) setModel(m); }); return () => { live = false; }; }, [tournamentId]);
  const slotIndex = model?.schedule.findIndex(s => s.tournamentId === tournamentId) ?? -1;
  const isFinal = model?.event.finalTournamentId === tournamentId;
  if (presentation === "home") return <div className="h-6 min-w-0 text-xs leading-6 text-[#e9b654]" data-testid="home-qualification-slot">{model && (slotIndex >= 0 || isFinal) ? <span className="block truncate">{isFinal ? "Закрытый финал · Калининград" : `Квалификация №${slotIndex + 1} · Калининград`}</span> : null}</div>;
  if (!model) return null;
  const slot = model.schedule.findIndex(s => s.tournamentId === tournamentId), final = model.event.finalTournamentId === tournamentId;
  if (slot < 0 && !final) return null;
  return <section className="my-2 min-w-0 text-xs text-[#e9b654]"><Link className="inline-flex min-h-8 items-center" href={`/qualifications/${model.event.slug}`}>{final ? "Закрытый финал отбора · без рейтинга" : `Квалификация №${slot + 1} · ${model.event.title}`} →</Link>{final && !compact ? <><p>18 подтверждённых участников · 50 000 фишек · без Re-entry и Add-on</p>{model.finalSurvivors?.length ? <><h3 className="mt-3 font-semibold">Прошли в сборную: трое оставшихся</h3><p className="text-white/60">Без распределения мест 1–3 и рейтинговых начислений</p>{model.finalSurvivors.map(p => <Link className="block min-h-9 py-2" key={p.player_id} href={`/players/${p.player_id}`}>{p.display_name}</Link>)}{model.finalEliminations?.length?<details className="mt-3"><summary className="min-h-9 cursor-pointer">Места выбывших</summary>{model.finalEliminations.map(p=><Link className="block min-h-9 py-2 text-white/70" key={p.player_id} href={`/players/${p.player_id}`}>{p.place} · {p.display_name}</Link>)}</details>:null}</> : null}</> : null}</section>;
}
