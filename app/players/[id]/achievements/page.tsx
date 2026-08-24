"use client";

import { BackButton } from "@/components/ui/back-button";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AchievementVisual } from "@/components/achievements/achievement-visual";
import type { AchievementVisualConfig } from "@/config/achievement-visuals";
import {
  buildAchievementDisplayModel,
  TIER_LABELS,
  type AchievementProgressRow,
  type LegendaryAchievementCard,
  type TieredAchievementCard,
} from "@/lib/achievement-display";

export default function PlayerAchievementsPage() {
  const params = useParams<{ id: string }>();
  const playerId = params?.id;
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AchievementProgressRow[]>([]);
  const [configs, setConfigs] = useState<Record<string, AchievementVisualConfig>>({});
  const [detail, setDetail] = useState<
    { kind: "family"; card: TieredAchievementCard }
    | { kind: "legendary"; card: LegendaryAchievementCard }
    | null
  >(null);

  useEffect(() => {
    async function load() {
      if (!playerId) return;
      try {
        const [progressResponse, visualsResponse] = await Promise.all([
          fetch(`/api/players/${playerId}/achievements`),
          fetch("/api/achievement-visuals"),
        ]);
        if (!progressResponse.ok || !visualsResponse.ok) {
          throw new Error("Не удалось загрузить достижения");
        }
        const progress = (await progressResponse.json()) as AchievementProgressRow[];
        const visuals = (await visualsResponse.json()) as { visuals: AchievementVisualConfig[] };
        setRows(progress);
        setConfigs(Object.fromEntries(visuals.visuals.map((config) => [config.visualKey, config])));
      } catch (error) {
        console.error("[achievements] load failed:", error);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [playerId]);

  const model = buildAchievementDisplayModel(rows);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#10271e_0,#050706_42%,#000_75%)] px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-md">
        <BackButton href={playerId ? `/players/${playerId}` : "/"} />
        <h1 className="mt-5 text-3xl font-bold tracking-tight">Достижения</h1>

        {loading ? (
          <p className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
            Загружаем достижения...
          </p>
        ) : (
          <>
            <section className="mt-7">
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-white/45">
                Основные достижения
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {model.families.map((card) => {
                  const target = card.nextTarget ?? card.tiers.at(-1)!.target;
                  const percent = card.maxLevel
                    ? 100
                    : Math.min(100, Math.round((card.currentValue / target) * 100));
                  return (
                    <button type="button" onClick={() => setDetail({ kind: "family", card })} key={card.family} className="rounded-3xl border border-white/10 bg-[#0d120f]/90 p-3.5 text-left">
                      <AchievementVisual
                        visualKey={card.visualKey}
                        tier={card.currentTier ?? card.nextTier ?? "bronze"}
                        configs={configs}
                        className="mx-auto h-28 w-28"
                      />
                      <h3 className="mt-2 text-base font-semibold">{card.name}</h3>
                      <p className="mt-0.5 min-h-5 text-xs font-medium text-[#d5b867]">
                        {card.currentTierLabel ?? "До Bronze"}
                      </p>
                      <p className="mt-2 text-xs text-white/55">
                        {card.maxLevel
                          ? "Максимальный уровень"
                          : `${card.currentValue} / ${card.nextTarget} ${card.unit}`}
                      </p>
                      {!card.maxLevel ? (
                        <p className="mt-0.5 text-[11px] text-white/35">До {card.nextTierLabel}</p>
                      ) : null}
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
                        <div className="h-full rounded-full bg-[#b99a45]" style={{ width: `${percent}%` }} />
                      </div>
                      <div className="mt-2 flex justify-between gap-1">
                        {card.tiers.map((tier) => (
                          <span
                            key={tier.tier}
                            title={TIER_LABELS[tier.tier]}
                            className={`h-1.5 flex-1 rounded-full ${tier.earned ? "bg-[#d5b867]" : "bg-white/10"}`}
                          />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-white/45">
                Легендарные
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {model.legendary.map((card) => (
                  <button type="button" onClick={() => setDetail({ kind: "legendary", card })} key={card.code} className="rounded-3xl border border-white/10 bg-[#0d120f]/90 p-3.5 text-left">
                    <AchievementVisual
                      visualKey={card.visualKey}
                      configs={configs}
                      locked={card.hidden && !card.earned}
                      dimmed={card.code === "royal_flush" && !card.earned}
                      className="mx-auto h-28 w-28"
                    />
                    <h3 className="mt-2 text-base font-semibold">{card.name}</h3>
                    <p className={`mt-2 text-[11px] font-semibold ${card.earned ? "text-[#d5b867]" : "text-white/30"}`}>
                      {card.earned ? "Получено" : "Заблокировано"}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70" onClick={() => setDetail(null)}>
          <section className="max-h-[86vh] w-full overflow-y-auto rounded-t-[30px] border border-white/10 bg-[#101612]/95 p-5 pb-[calc(env(safe-area-inset-bottom)+24px)] shadow-2xl backdrop-blur-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
            <div className="mx-auto max-w-md">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold">{detail.card.name}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-white/55">{detail.card.description}</p>
                </div>
                <button type="button" onClick={() => setDetail(null)} className="rounded-full bg-white/10 px-3 py-1.5 text-sm text-white/70">Закрыть</button>
              </div>

              {detail.kind === "family" ? (
                <>
                  <p className="mt-4 text-sm text-white/70">Текущий результат: {detail.card.currentValue} {detail.card.unit}</p>
                  <div className="mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
                    {detail.card.tiers.map((tier) => {
                      const status = tier.earned ? "Получено" : detail.card.currentValue > 0 ? "В процессе" : "Закрыто";
                      return (
                        <article key={tier.tier} className="w-[88%] shrink-0 snap-center rounded-3xl border border-white/10 bg-black/30 p-4">
                          <AchievementVisual visualKey={detail.card.visualKey} tier={tier.tier} configs={configs} className="mx-auto h-40 w-40" />
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <h3 className="font-semibold">{detail.card.family === "player_path" ? tier.name : TIER_LABELS[tier.tier]}</h3>
                            <span className={tier.earned ? "text-xs font-semibold text-[#d5b867]" : "text-xs text-white/40"}>{status}</span>
                          </div>
                          <p className="mt-2 text-sm text-white/60">{tier.description}</p>
                          <p className="mt-1 text-xs text-white/40">Цель: {tier.target} {detail.card.unit}</p>
                          {tier.completedAt ? <p className="mt-2 text-xs text-white/45">Получено {new Date(tier.completedAt).toLocaleDateString("ru-RU")}</p> : null}
                        </article>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="mt-5 rounded-3xl border border-white/10 bg-black/30 p-5 text-center">
                  <AchievementVisual visualKey={detail.card.visualKey} configs={configs} locked={detail.card.hidden && !detail.card.earned} dimmed={detail.card.code === "royal_flush" && !detail.card.earned} className="mx-auto h-44 w-44" />
                  <p className={`mt-3 text-xs font-semibold ${detail.card.earned ? "text-[#d5b867]" : "text-white/35"}`}>{detail.card.earned ? "Получено" : detail.card.code === "royal_flush" ? "Заблокировано" : "Закрыто"}</p>
                  {detail.card.completedAt ? <p className="mt-1 text-xs text-white/40">Получено {new Date(detail.card.completedAt).toLocaleDateString("ru-RU")}</p> : null}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
