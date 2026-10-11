"use client";

import Link from "next/link";
import { useId, useState, useSyncExternalStore } from "react";
import { PreflopTrainerSetup } from "@/components/academy/preflop-trainer-setup";
import { ACADEMY_PREFLOP_SETUP_HASH } from "@/config/academy/navigation-routes";
import { ACADEMY_PREFLOP_QUICK_MIX_ROUTE } from "@/config/academy/preflop-trainer";
import type { AcademyPreflopTrainerSpot } from "@/types/academy";

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function setupRequestedByHash(): boolean {
  return window.location.hash === `#${ACADEMY_PREFLOP_SETUP_HASH}`;
}

/**
 * Two clearly separated entry points: the primary zero-configuration
 * "Быстрая тренировка" and the secondary "Настроить ситуацию", which reveals
 * the manual picker in place. The picker is never forced before Quick Mix —
 * it opens on arrival only when the link asked for it (`#setup`, e.g. from
 * "Тренажёры → Настроить ситуацию"); the server render is always closed.
 */
export function PreflopTrainerHome({ spots }: { spots: readonly AcademyPreflopTrainerSpot[] }) {
  const setupRequested = useSyncExternalStore(subscribeToHash, setupRequestedByHash, () => false);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const manualOpen = toggled ?? setupRequested;
  const manualId = useId();

  return (
    <div className="mt-6" data-testid="preflop-trainer-home">
      <section
        data-entry="quick-mix"
        aria-labelledby={`${manualId}-quick`}
        className="rounded-[28px] border border-[#d7b55a]/35 bg-[radial-gradient(ellipse_90%_70%_at_100%_0%,rgba(215,181,90,0.16),transparent_70%),rgba(255,255,255,0.045)] p-5"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d7b55a]">Без настройки</p>
        <h2 id={`${manualId}-quick`} className="mt-2 text-2xl font-bold tracking-tight">Быстрая тренировка</h2>
        <p className="mt-2 text-sm leading-6 text-white/65">10 случайных решений из разных стеков и ситуаций</p>
        <Link
          href={ACADEMY_PREFLOP_QUICK_MIX_ROUTE}
          data-testid="quick-mix-start"
          className="mt-5 flex min-h-14 items-center justify-center rounded-2xl bg-[#d7b55a] px-5 py-4 text-base font-semibold text-[#11120f] active:bg-[#e2c66f]"
        >
          Начать
        </Link>
      </section>

      <section
        id={ACADEMY_PREFLOP_SETUP_HASH}
        data-entry="manual"
        aria-labelledby={`${manualId}-manual`}
        className="mt-4 rounded-[24px] border border-white/[0.09] bg-white/[0.03] p-5"
      >
        <h2 id={`${manualId}-manual`} className="text-lg font-semibold">Настроить ситуацию</h2>
        <p className="mt-1 text-sm leading-6 text-white/55">Выбери стек, ситуацию и позиции сам</p>
        <button
          type="button"
          data-testid="manual-toggle"
          aria-expanded={manualOpen}
          aria-controls={`${manualId}-setup`}
          onClick={() => setToggled(!manualOpen)}
          className="mt-4 flex min-h-12 w-full items-center justify-center rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-3 text-sm font-semibold text-white/85 active:bg-white/[0.08]"
        >
          {manualOpen ? "Скрыть настройку" : "Выбрать ситуацию"}
        </button>
        <div id={`${manualId}-setup`} hidden={!manualOpen}>
          {manualOpen ? <PreflopTrainerSetup spots={spots} /> : null}
        </div>
      </section>
    </div>
  );
}
