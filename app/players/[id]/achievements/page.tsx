"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AchievementVisual } from "@/components/achievements/achievement-visual";
import type { AchievementVisualConfig } from "@/config/achievement-visuals";
import {
  buildAchievementDisplayModel,
  TIER_LABELS,
  type AchievementProgressRow,
} from "@/lib/achievement-display";

export default function PlayerAchievementsPage() {
  const params = useParams<{ id: string }>();
  const playerId = params?.id;
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AchievementProgressRow[]>([]);
  const [configs, setConfigs] = useState<Record<string, AchievementVisualConfig>>({});

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
        <Link href={playerId ? `/players/${playerId}` : "/"} className="text-sm text-white/55">
          ← Назад
        </Link>
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
                    <article key={card.family} className="rounded-3xl border border-white/10 bg-[#0d120f]/90 p-3.5">
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
                    </article>
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
                  <article key={card.code} className="rounded-3xl border border-white/10 bg-[#0d120f]/90 p-3.5">
                    <AchievementVisual
                      visualKey={card.visualKey}
                      configs={configs}
                      locked={card.hidden && !card.earned}
                      className="mx-auto h-28 w-28"
                    />
                    <h3 className="mt-2 text-base font-semibold">{card.name}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-white/45">{card.description}</p>
                    <p className={`mt-2 text-[11px] font-semibold ${card.earned ? "text-[#d5b867]" : "text-white/30"}`}>
                      {card.earned ? "Получено" : "Заблокировано"}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
