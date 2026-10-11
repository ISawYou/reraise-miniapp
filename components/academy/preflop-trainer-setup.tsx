"use client";

import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { PokerPositionTable } from "@/components/academy/poker-position-table";
import { preflopTrainerSpotRoute, preflopTrainerTrainRoute } from "@/config/academy/preflop-trainer";
import {
  ACADEMY_PREFLOP_TRAINER_SEAT_HINTS,
  ACADEMY_PREFLOP_TRAINER_SITUATION_LABELS,
  describePreflopTrainerSpot,
} from "@/lib/academy/preflop-trainer-copy";
import {
  findPreflopTrainerSpot,
  listPreflopTrainerHeroPositions,
  listPreflopTrainerSituations,
  listPreflopTrainerStacks,
  listPreflopTrainerVillainPositions,
  preflopTrainerSituationHasVillain,
} from "@/lib/academy/preflop-trainer-selection";
import type { AcademyPreflopTrainerSituation, AcademyPreflopTrainerSpot } from "@/types/academy";

/** Blind-defence / blind-vs-blind shortcuts; shown only when a real node exists. */
const QUICK_SPOTS: ReadonlyArray<{ hero: string; villain: string }> = [
  { hero: "BB", villain: "BTN" },
  { hero: "BB", villain: "CO" },
  { hero: "BB", villain: "SB" },
  { hero: "SB", villain: "BTN" },
  { hero: "SB", villain: "CO" },
];

type ChipProps = {
  label: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
  testId: string;
};

function Chip({ label, hint, selected, onSelect, testId }: ChipProps) {
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
 * Stack → situation → seats picker. Stack and situation are chips; seats are
 * picked by tapping the table ("Где ты сидишь?" / "Где ты?" → "Кто сделал
 * действие?"), with a compact chip list as an equivalent alternative. Every
 * step offers ONLY options
 * backed by a real node in `spots` (the server-derived list of the
 * registered datasets' nodes); changing an earlier step drops later choices
 * that are no longer available.
 */
export function PreflopTrainerSetup({ spots }: { spots: readonly AcademyPreflopTrainerSpot[] }) {
  const stacks = useMemo(() => listPreflopTrainerStacks(spots), [spots]);
  const [stackBb, setStackBb] = useState<number | null>(null);
  const [situation, setSituation] = useState<AcademyPreflopTrainerSituation | null>(null);
  const [hero, setHero] = useState<string | null>(null);
  const [villain, setVillain] = useState<string | null>(null);

  const situations = stackBb === null ? [] : listPreflopTrainerSituations(spots, stackBb);
  const heroes = stackBb === null || situation === null ? [] : listPreflopTrainerHeroPositions(spots, stackBb, situation);
  const villains = stackBb === null || situation === null || hero === null
    ? []
    : listPreflopTrainerVillainPositions(spots, stackBb, situation, hero);
  const needsVillain = situation !== null && preflopTrainerSituationHasVillain(situation);
  const spot = stackBb !== null && situation !== null && hero !== null && (!needsVillain || villain !== null)
    ? findPreflopTrainerSpot(spots, { stackBb, situation, heroPosition: hero, villainPosition: needsVillain ? villain : null })
    : null;

  function chooseStack(value: number) {
    setStackBb(value);
    const nextSituations = listPreflopTrainerSituations(spots, value);
    if (situation && !nextSituations.includes(situation)) {
      setSituation(null);
      setHero(null);
      setVillain(null);
    } else if (situation && hero) {
      if (!listPreflopTrainerHeroPositions(spots, value, situation).includes(hero)) {
        setHero(null);
        setVillain(null);
      } else if (villain && !listPreflopTrainerVillainPositions(spots, value, situation, hero).includes(villain)) {
        setVillain(null);
      }
    }
  }

  function chooseSituation(value: AcademyPreflopTrainerSituation) {
    setSituation(value);
    setHero(null);
    setVillain(null);
  }

  function chooseHero(value: string | null) {
    setHero(value);
    setVillain(null);
  }

  const selectingVillain = needsVillain && hero !== null;
  const seatPrompt = situation === null || !needsVillain
    ? "Где ты сидишь?"
    : selectingVillain ? "Кто сделал действие?" : "Где ты?";

  const quickSpots = stackBb === null
    ? []
    : QUICK_SPOTS.filter(({ hero: quickHero, villain: quickVillain }) =>
      findPreflopTrainerSpot(spots, { stackBb, situation: "FACING_OPEN", heroPosition: quickHero, villainPosition: quickVillain }));

  const copy = spot ? describePreflopTrainerSpot(spot) : null;

  return (
    <div data-testid="preflop-trainer-setup">
      <Step index={1} title="Стек">
        <div className="grid grid-cols-5 gap-2">
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

      {stackBb !== null ? (
        <Step index={2} title="Ситуация">
          <div className="grid grid-cols-2 gap-2 min-[380px]:grid-cols-3">
            {situations.map((value) => (
              <Chip
                key={value}
                label={ACADEMY_PREFLOP_TRAINER_SITUATION_LABELS[value]}
                selected={situation === value}
                onSelect={() => chooseSituation(value)}
                testId={`situation-${value}`}
              />
            ))}
          </div>
          {quickSpots.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs text-white/45">Защита блайндов — быстрый выбор</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {quickSpots.map(({ hero: quickHero, villain: quickVillain }) => (
                  <Chip
                    key={`${quickHero}-${quickVillain}`}
                    label={`${quickHero} vs ${quickVillain}`}
                    selected={situation === "FACING_OPEN" && hero === quickHero && villain === quickVillain}
                    onSelect={() => {
                      setSituation("FACING_OPEN");
                      setHero(quickHero);
                      setVillain(quickVillain);
                    }}
                    testId={`quick-${quickHero}-${quickVillain}`}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </Step>
      ) : null}

      {situation !== null ? (
        <Step index={3} title="Позиции за столом">
          <div className="flex items-center justify-between gap-3">
            <p className="text-lg font-semibold" data-testid="seat-prompt">{seatPrompt}</p>
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
          {!selectingVillain ? (
            <div className="mt-4">
              <p className="text-xs text-white/40">Или выбери из списка</p>
              <div className="mt-2 grid grid-cols-3 gap-2 min-[380px]:grid-cols-5">
                {heroes.map((value) => (
                  <Chip
                    key={value}
                    label={value}
                    hint={ACADEMY_PREFLOP_TRAINER_SEAT_HINTS[value]}
                    selected={hero === value}
                    onSelect={() => chooseHero(value)}
                    testId={`hero-${value}`}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </Step>
      ) : null}

      {selectingVillain ? (
        <Step index={4} title="Соперник — или из списка">
          <div className="grid grid-cols-3 gap-2 min-[380px]:grid-cols-5">
            {villains.map((value) => (
              <Chip
                key={value}
                label={value}
                hint={ACADEMY_PREFLOP_TRAINER_SEAT_HINTS[value]}
                selected={villain === value}
                onSelect={() => setVillain(value)}
                testId={`villain-${value}`}
              />
            ))}
          </div>
        </Step>
      ) : null}

      {spot && copy ? (
        <section className="mt-7 rounded-[24px] border border-white/[0.08] bg-white/[0.04] p-4" data-selected-node={spot.nodeKey}>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#d7b55a]">
            {spot.stackBb} BB · {copy.situationLabel}
          </p>
          <p className="mt-2 text-lg font-semibold">{copy.title}</p>
          <p className="mt-1 text-sm text-white/55">{copy.history}</p>
          <div className="mt-4 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
            <Link
              href={preflopTrainerTrainRoute(spot.stackBb, spot.nodeKey)}
              className="flex min-h-12 items-center justify-center rounded-2xl bg-[#d7b55a] px-4 py-3 text-sm font-semibold text-[#11120f]"
            >
              Начать тренировку
            </Link>
            <Link
              href={preflopTrainerSpotRoute(spot.stackBb, spot.nodeKey)}
              className="flex min-h-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm font-medium text-white/75"
            >
              Посмотреть диапазон
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
