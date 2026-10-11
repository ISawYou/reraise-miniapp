"use client";

import Link from "next/link";
import { type ReactNode, useId, useMemo, useState } from "react";
import { PokerPositionTable } from "@/components/academy/poker-position-table";
import { ACADEMY_PREFLOP_SETUP_HASH } from "@/config/academy/navigation-routes";
import {
  ACADEMY_PUSH_FOLD_QUICK_ROUTE,
  pushFoldSpotRoute,
  pushFoldTrainRoute,
} from "@/config/academy/push-fold-trainer";
import { ACADEMY_PREFLOP_TRAINER_SEAT_HINTS } from "@/lib/academy/preflop-trainer-copy";
import {
  ACADEMY_PUSH_FOLD_SITUATION_HINTS,
  ACADEMY_PUSH_FOLD_SITUATION_LABELS,
  describePushFoldSpot,
} from "@/lib/academy/push-fold-copy";
import {
  ACADEMY_PUSH_FOLD_SITUATIONS,
  findPushFoldSpot,
  listPushFoldHeroPositions,
  listPushFoldStacks,
  listPushFoldVillainPositions,
  pushFoldSituationHasVillain,
} from "@/lib/academy/push-fold-selection";
import type { AcademyPushFoldSituation, AcademyPushFoldSpot } from "@/types/academy";

/** Blind call shortcuts; shown only when a real node exists at the stack. */
const CALL_SHORTCUTS: ReadonlyArray<{ hero: string; villain: string }> = [
  { hero: "BB", villain: "SB" },
  { hero: "BB", villain: "BTN" },
  { hero: "SB", villain: "BTN" },
];

function Chip({ label, hint, selected, onSelect, testId }: {
  label: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-option={testId}
      onClick={onSelect}
      className={`flex min-h-11 min-w-0 flex-col items-center justify-center break-words rounded-2xl border px-2 py-2 text-sm font-semibold transition-colors ${
        selected
          ? "border-[#d7b55a]/70 bg-[#d7b55a]/15 text-white"
          : "border-white/10 bg-white/[0.045] text-white/75 active:bg-white/[0.08]"
      }`}
    >
      <span>{label}</span>
      {hint ? <span className="mt-0.5 text-[10px] font-normal text-white/40">{hint}</span> : null}
    </button>
  );
}

function Step({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <section className="mt-6" data-step={index}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
        Шаг {index} · {title}
      </p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Push/Fold home: family ("Пушить первым" / "Коллировать пуш") → stack →
 * seat(s) on the shared table (POSITION_SELECTION) → the node's range page.
 * Every option is backed by a real node of `spots` (server-derived from the
 * whitelisted datasets). Scored entry points (the "Быстрая Push/Fold
 * тренировка" card, "Начать тренировку") are rendered ONLY for datasets in
 * `scoredDatasetIds` — currently none, so the page is a non-scored reference.
 */
export function PushFoldHome({
  spots,
  scoredDatasetIds = [],
}: {
  spots: readonly AcademyPushFoldSpot[];
  /** Datasets validated for SCORED training (server-provided). Empty → reference only. */
  scoredDatasetIds?: readonly string[];
}) {
  const headingId = useId();
  const [situation, setSituation] = useState<AcademyPushFoldSituation | null>(null);
  const [stackBb, setStackBb] = useState<number | null>(null);
  const [hero, setHero] = useState<string | null>(null);
  const [villain, setVillain] = useState<string | null>(null);

  const stacks = useMemo(() => (situation ? listPushFoldStacks(spots, situation) : []), [spots, situation]);
  const heroes = situation && stackBb !== null ? listPushFoldHeroPositions(spots, stackBb, situation) : [];
  const needsVillain = situation !== null && pushFoldSituationHasVillain(situation);
  const villains = situation && stackBb !== null && hero ? listPushFoldVillainPositions(spots, stackBb, situation, hero) : [];
  const spot = situation && stackBb !== null && hero && (!needsVillain || villain)
    ? findPushFoldSpot(spots, { stackBb, situation, heroPosition: hero, villainPosition: needsVillain ? villain : null })
    : null;
  const selectingVillain = needsVillain && hero !== null;

  function chooseSituation(value: AcademyPushFoldSituation) {
    setSituation(value);
    setHero(null);
    setVillain(null);
    if (stackBb !== null && !listPushFoldStacks(spots, value).includes(stackBb)) setStackBb(null);
  }

  function chooseStack(value: number) {
    setStackBb(value);
    if (!situation) return;
    if (hero && !listPushFoldHeroPositions(spots, value, situation).includes(hero)) {
      setHero(null);
      setVillain(null);
    } else if (hero && villain && !listPushFoldVillainPositions(spots, value, situation, hero).includes(villain)) {
      setVillain(null);
    }
  }

  function chooseHero(value: string | null) {
    setHero(value);
    setVillain(null);
  }

  const shortcuts = situation === "CALL_VS_SHOVE" && stackBb !== null
    ? CALL_SHORTCUTS.filter((entry) =>
      findPushFoldSpot(spots, { stackBb, situation, heroPosition: entry.hero, villainPosition: entry.villain }))
    : [];
  const copy = spot ? describePushFoldSpot(spot) : null;
  const spotScored = spot !== null && scoredDatasetIds.includes(spot.datasetId);

  return (
    <div className="mt-6" data-testid="push-fold-home">
      {scoredDatasetIds.length > 0 ? (
      <section
        data-entry="quick"
        aria-labelledby={`${headingId}-quick`}
        className="rounded-[28px] border border-[#d7b55a]/35 bg-[radial-gradient(ellipse_90%_70%_at_100%_0%,rgba(215,181,90,0.16),transparent_70%),rgba(255,255,255,0.045)] p-5"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d7b55a]">Без настройки</p>
        <h2 id={`${headingId}-quick`} className="mt-2 text-2xl font-bold tracking-tight">Быстрая Push/Fold тренировка</h2>
        <p className="mt-2 text-sm leading-6 text-white/65">
          10 решений: разные стеки от 4 до 15 BB, пуш первым и колл олл-ина
        </p>
        <Link
          href={ACADEMY_PUSH_FOLD_QUICK_ROUTE}
          data-testid="push-fold-quick-start"
          className="mt-5 flex min-h-14 items-center justify-center rounded-2xl bg-[#d7b55a] px-5 py-4 text-base font-semibold text-[#11120f] active:bg-[#e2c66f]"
        >
          Начать
        </Link>
      </section>
      ) : null}

      <section
        id={ACADEMY_PREFLOP_SETUP_HASH}
        data-entry="manual"
        aria-labelledby={`${headingId}-manual`}
        className="mt-4 rounded-[24px] border border-white/[0.09] bg-white/[0.03] p-5"
      >
        <h2 id={`${headingId}-manual`} className="text-lg font-semibold">Выбрать ситуацию</h2>
        <p className="mt-1 text-sm leading-6 text-white/55">{scoredDatasetIds.length > 0 ? "Что тренируем?" : "Какой диапазон посмотреть?"}</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {ACADEMY_PUSH_FOLD_SITUATIONS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={situation === value}
              data-family={value}
              onClick={() => chooseSituation(value)}
              className={`flex min-h-24 min-w-0 flex-col items-start justify-between rounded-2xl border p-3.5 text-left transition-colors ${
                situation === value
                  ? "border-[#d7b55a]/70 bg-[#d7b55a]/15"
                  : "border-white/10 bg-white/[0.045] active:bg-white/[0.08]"
              }`}
            >
              <span className="text-base font-semibold leading-5 text-white">{ACADEMY_PUSH_FOLD_SITUATION_LABELS[value]}</span>
              <span className="mt-2 text-xs leading-4 text-white/50">{ACADEMY_PUSH_FOLD_SITUATION_HINTS[value]}</span>
            </button>
          ))}
        </div>

        {situation ? (
          <Step index={2} title="Стек">
            <div className="grid grid-cols-3 gap-2">
              {stacks.map((value) => (
                <Chip
                  key={value}
                  label={`${value} BB`}
                  selected={stackBb === value}
                  onSelect={() => chooseStack(value)}
                  testId={`stack-${value}`}
                />
              ))}
            </div>
          </Step>
        ) : null}

        {situation && stackBb !== null ? (
          <Step index={3} title={needsVillain ? "Позиции" : "Позиция"}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-lg font-semibold" data-testid="seat-prompt">
                {!needsVillain ? "Где ты сидишь?" : selectingVillain ? "Кто пошёл олл-ин?" : "Где ты сидишь?"}
              </p>
              {selectingVillain ? (
                <button
                  type="button"
                  data-testid="change-hero"
                  onClick={() => chooseHero(null)}
                  className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-white/65"
                >
                  Сменить позицию
                </button>
              ) : null}
            </div>
            <div className="mt-3">
              <PokerPositionTable
                mode="POSITION_SELECTION"
                selecting={selectingVillain ? "VILLAIN" : "HERO"}
                heroSeat={hero}
                villainSeat={villain}
                selectableSeats={selectingVillain ? villains : heroes}
                onSelectSeat={selectingVillain ? setVillain : chooseHero}
              />
            </div>
            <div className="mt-4">
              <p className="text-xs text-white/40">{selectingVillain ? "Пушер — или из списка" : "Или выбери из списка"}</p>
              <div className="mt-2 grid grid-cols-4 gap-2 min-[380px]:grid-cols-5">
                {(selectingVillain ? villains : heroes).map((value) => (
                  <Chip
                    key={value}
                    label={value}
                    hint={ACADEMY_PREFLOP_TRAINER_SEAT_HINTS[value]}
                    selected={selectingVillain ? villain === value : hero === value}
                    onSelect={() => (selectingVillain ? setVillain(value) : chooseHero(value))}
                    testId={`${selectingVillain ? "villain" : "hero"}-${value}`}
                  />
                ))}
              </div>
            </div>
            {shortcuts.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs text-white/40">Блайнды — быстрый выбор</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {shortcuts.map((entry) => (
                    <Chip
                      key={`${entry.hero}-${entry.villain}`}
                      label={`${entry.hero} vs ${entry.villain}`}
                      selected={hero === entry.hero && villain === entry.villain}
                      onSelect={() => {
                        setHero(entry.hero);
                        setVillain(entry.villain);
                      }}
                      testId={`shortcut-${entry.hero}-${entry.villain}`}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </Step>
        ) : null}

        {spot && copy ? (
          <section className="mt-7 rounded-[24px] border border-white/[0.08] bg-white/[0.04] p-4" data-selected-node={spot.nodeKey}>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#d7b55a]">
              {spot.stackBb} BB · {copy.situationLabel}
            </p>
            <p className="mt-2 text-lg font-semibold">{copy.title}</p>
            <p className="mt-1 text-sm text-white/55">{copy.history}</p>
            <div className={`mt-4 grid grid-cols-1 gap-2 ${spotScored ? "min-[380px]:grid-cols-2" : ""}`}>
              {spotScored ? (
                <Link
                  href={pushFoldTrainRoute(spot.stackBb, spot.nodeKey)}
                  className="flex min-h-12 items-center justify-center rounded-2xl bg-[#d7b55a] px-4 py-3 text-sm font-semibold text-[#11120f]"
                >
                  Начать тренировку
                </Link>
              ) : null}
              <Link
                href={pushFoldSpotRoute(spot.stackBb, spot.nodeKey)}
                data-testid="push-fold-study-link"
                className={spotScored
                  ? "flex min-h-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm font-medium text-white/75"
                  : "flex min-h-12 items-center justify-center rounded-2xl bg-[#d7b55a] px-4 py-3 text-sm font-semibold text-[#11120f]"}
              >
                Посмотреть диапазон
              </Link>
            </div>
          </section>
        ) : null}
      </section>
    </div>
  );
}
