/**
 * Academy trainer polish v2 (UI): quieter, larger table; honest but compact
 * pot / ante; compact feedback; three-tier "Тренажёры"; real progress for
 * "Продвинутым" and "Новичкам · Шаг 2".
 */
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademyProgressResponse, AcademySpotProgress } from "@/features/academy";
import type { AcademyPreflopTableMoney, AcademyPreflopTableScene } from "@/types/academy";

const mocks = vi.hoisted(() => ({
  progress: { data: null as AcademyProgressResponse | null, error: null as string | null, retry: () => {} },
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/academy",
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest} onClick={(event) => event.preventDefault()}>{children}</a>
  ),
}));

vi.mock("@/components/academy/use-academy-progress", () => ({
  useAcademyProgress: () => mocks.progress,
}));

const {
  PokerPositionTable,
  TRAINING_SCENE_FELT,
  trainingSceneAntePresentation,
  trainingScenePlateSize,
} = await import("@/components/academy/poker-position-table");
const { PreflopQuickMix } = await import("@/components/academy/preflop-trainer");
const { TrainerFeedbackPanel } = await import("@/components/academy/trainer-session-ui");
const { default: TrainersPage } = await import("@/app/academy/trainers/page");
const { default: AdvancedPage } = await import("@/app/academy/advanced/page");
const { default: BeginnerPage } = await import("@/app/academy/beginner/page");
const { ACADEMY_ADVANCED_STUDY_SPOTS } = await import("@/config/academy/navigation");
const { ACADEMY_BEGINNER_AFTER_OPEN_LESSONS } = await import("@/config/academy/beginner-after-open");
const { academySpotProgressCode } = await import("@/config/academy/spot-progress");
const { ACADEMY_TRAINING_PRESETS } = await import("@/config/academy/training-presets");
const { buildPreflopTableMoney, resolveAnteSemantics, resolvePreflopHandState } = await import("@/lib/academy/preflop-sizing");
const { ACADEMY_MTT_REFERENCE_SIZING_PROFILES } = await import("@/config/academy/preflop-sizing-profiles");
const { getAcademyPreflopRange } = await import("@/config/academy/preflop-ranges");
const { buildAcademyPreflopMixSession } = await import("@/lib/academy/preflop-mix");
const {
  listAcademyPreflopTrainerSpots,
  requireAcademyPreflopTrainerSpotByStack,
  toPreflopTrainerReveal,
  toPublicPreflopTrainerQuestion,
  toPublicPreflopTrainerSpot,
} = await import("@/lib/academy/preflop-trainer");

const PLAYER_ID = "55555555-5555-4555-8555-555555555555";
const ATTEMPT_ID = "77777777-7777-4777-8777-777777777777";

let container: HTMLDivElement;
let root: Root;

async function render(element: ReactElement) {
  await act(async () => {
    root.render(element);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error("element not found");
  await act(async () => {
    (element as HTMLElement).click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const $ = (selector: string) => container.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => Array.from(container.querySelectorAll<HTMLElement>(selector));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv("SESSION_SECRET", "trainer-polish-v2-secret");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.progress.data = null;
  mocks.progress.error = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function staticScene(scene: AcademyPreflopTableScene, stackBb: number, presentation?: "BASIC" | "ADVANCED", table?: AcademyPreflopTableMoney) {
  const holder = document.createElement("div");
  holder.innerHTML = renderToStaticMarkup(
    <PokerPositionTable mode="TRAINING_SCENE" scene={scene} stackBb={stackBb} presentation={presentation} table={table} />,
  );
  return holder;
}

const publicSpot = (stackBb: number, nodeKey: string) => toPublicPreflopTrainerSpot(requireAcademyPreflopTrainerSpotByStack(stackBb, nodeKey).spot);

function plateBox(holder: HTMLElement, seat: string) {
  const node = holder.querySelector(`[data-table-seat="${seat}"]`)!;
  const rect = node.querySelector("rect")!;
  return { w: Number(rect.getAttribute("width")), h: Number(rect.getAttribute("height")), rx: Number(rect.getAttribute("rx")), rect };
}

// ---------------------------------------------------------------------------
// (1)–(4) table
// ---------------------------------------------------------------------------

describe("(1) folded seats are quiet: no 'Фолд' label at every folded seat", () => {
  it("7 folded seats (40 BB, UTG opens, SB 3-bets): no chip, no text, smaller dashed dim capsules", () => {
    const spot = publicSpot(40, "FACING_3BET_UTG_VS_SB");
    for (const presentation of ["BASIC", "ADVANCED"] as const) {
      const holder = staticScene(spot.scene, 40, presentation, spot.table);
      const folded = spot.scene.seats.filter((seat) => seat.role === "folded").map((seat) => seat.seat);
      expect(folded).toHaveLength(7);
      // The scene MODEL still says "Фолд" (builders unchanged) — only the rendering is quiet.
      expect(spot.scene.seats.filter((seat) => seat.actionLabel === "Фолд")).toHaveLength(7);
      expect(holder.textContent).not.toContain("Фолд");
      for (const seat of folded) {
        expect(holder.querySelector(`[data-seat-action="${seat}"]`), seat).toBeNull();
        const plate = holder.querySelector(`[data-table-seat="${seat}"]`)!;
        expect(plate.getAttribute("data-seat-folded")).toBe("true");
        expect(plate.querySelector("text")!.textContent).toBe(seat); // just the seat name
        const { w, h, rect } = plateBox(holder, seat);
        expect([w, h]).toEqual([trainingScenePlateSize("folded").width, trainingScenePlateSize("folded").height]);
        expect(rect.getAttribute("stroke-dasharray")).toBeTruthy();
        // No stack numbers on folded seats.
        expect(holder.querySelector(`[data-seat-stack="${seat}"]`)).toBeNull();
      }
      // Only the key actions remain as chips: the hero's open and the villain's 3-bet.
      expect(Array.from(holder.querySelectorAll("[data-seat-action]")).map((node) => node.getAttribute("data-seat-action")).sort()).toEqual(["SB", "UTG"]);
    }
  });

  it("across EVERY real spot: action chips only on hero / villain, never 'Фолд'", () => {
    const spots = listAcademyPreflopTrainerSpots().map((spot) => toPublicPreflopTrainerSpot(spot));
    for (const spot of spots) {
      const holder = staticScene(spot.scene, spot.stackBb, "ADVANCED", spot.table);
      const roles = Array.from(holder.querySelectorAll("[data-seat-action]")).map((node) => node.getAttribute("data-seat-role"));
      expect(roles.every((role) => role === "hero" || role === "villain"), `${spot.stackBb} ${spot.nodeKey}`).toBe(true);
      expect(holder.textContent, `${spot.stackBb} ${spot.nodeKey}`).not.toContain("Фолд");
    }
  });
});

describe("(2) the table stays large / immersive", () => {
  it("same 360×384 portrait view; the felt is LARGER than before (seats on the rail); plates fit the old boxes", () => {
    const spot = publicSpot(40, "FACING_OPEN_BB_VS_BTN");
    const holder = staticScene(spot.scene, 40);
    expect(holder.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 360 384");
    const felt = holder.querySelectorAll("ellipse")[1];
    expect(Number(felt.getAttribute("rx"))).toBe(TRAINING_SCENE_FELT.rx);
    // Previous felt: 123 × 151 (+ 133 × 161 rail).
    expect(TRAINING_SCENE_FELT.rx).toBeGreaterThan(123);
    expect(TRAINING_SCENE_FELT.ry).toBeGreaterThan(151);
    // Compact capsules, each inside the previous plate box (76×40 seats, 124×46 hero).
    for (const role of ["waiting", "villain", "folded"] as const) {
      const size = trainingScenePlateSize(role);
      expect(size.width).toBeLessThanOrEqual(76);
      expect(size.height).toBeLessThanOrEqual(40);
    }
    expect(trainingScenePlateSize("hero").width).toBeLessThanOrEqual(124);
    expect(trainingScenePlateSize("hero").height).toBeLessThanOrEqual(46);
    const hero = plateBox(holder, "BB");
    expect(hero.rx).toBe(hero.h / 2); // capsule
  });
});

describe("(3) hero and villain stand out", () => {
  it("hero gold + 'Ты', villain red + 'Соперник', both larger than folded / waiting seats", () => {
    const spot = publicSpot(40, "FACING_OPEN_BB_VS_BTN");
    const holder = staticScene(spot.scene, 40, "ADVANCED", spot.table);
    expect(holder.querySelector('[data-table-seat="BB"]')!.getAttribute("aria-label")).toBe("BB, ты");
    expect(holder.querySelector('[data-table-seat="BTN"]')!.getAttribute("aria-label")).toBe("BTN, соперник");
    expect(plateBox(holder, "BB").rect.getAttribute("fill")).toBe("#d7b55a");
    expect(plateBox(holder, "BTN").rect.getAttribute("fill")).toBe("#6b2d31");
    const area = (seat: string) => plateBox(holder, seat).w * plateBox(holder, seat).h;
    expect(area("BB")).toBeGreaterThan(area("BTN"));
    expect(area("BTN")).toBeGreaterThan(area("CO"));
    expect(holder.querySelector('[data-seat-action="BTN"]')!.textContent).toBe("Рейз");
  });
});

describe("(4) all-in stays very clear", () => {
  it("20 BB HJ opens, SB jams: red ALL-IN chip marker, 'Олл-ин · 0' stack, 'Олл-ин' action chip", () => {
    const spot = publicSpot(20, "FACING_3BET_HJ_VS_SB");
    const holder = staticScene(spot.scene, 20, "ADVANCED", spot.table);
    const bet = holder.querySelector('[data-seat-bet="SB"]')!;
    expect(bet.getAttribute("data-all-in")).toBe("true");
    expect(bet.textContent).toContain("ALL-IN");
    expect(bet.querySelector("rect")!.getAttribute("fill")).toBe("#5a1d21");
    expect(holder.querySelector('[data-seat-stack="SB"]')!.textContent).toBe("Олл-ин · 0");
    expect(holder.querySelector('[data-seat-action="SB"]')!.textContent).toBe("Олл-ин");
  });
});

// ---------------------------------------------------------------------------
// (5) pot / ante presentation (policy unchanged)
// ---------------------------------------------------------------------------

describe("(5) pot + ante: compact, honest presentation over the UNCHANGED pot policy", () => {
  it("every real MTT spot: the number is the known contributions only; '+ анте' + one-line 'Анте 1 BB' pill; caveat kept in tooltip", () => {
    const spots = listAcademyPreflopTrainerSpots().map((spot) => toPublicPreflopTrainerSpot(spot)).filter((spot) => spot.table);
    expect(spots.length).toBeGreaterThan(200);
    for (const spot of spots) {
      const table = spot.table!;
      expect(table.pot.kind).toBe("WITHOUT_ANTE");
      expect(table.ante).toEqual({ kind: "AMBIGUOUS", declaredBb: 1 });
      const known = table.seats.reduce((sum, seat) => sum + seat.committedBb, 0);
      expect(table.pot.kind === "WITHOUT_ANTE" && table.pot.knownBb).toBeCloseTo(known, 6);
      const holder = staticScene(spot.scene, spot.stackBb, "ADVANCED", table);
      expect(Number(holder.querySelector("[data-table-pot]")!.getAttribute("data-pot-bb"))).toBeCloseTo(known, 6);
      const pill = holder.querySelector("[data-ante-note]")!;
      // One compact line on the felt — not a disclaimer block.
      expect(pill.querySelectorAll("text")).toHaveLength(1);
      expect(pill.querySelector("text")!.textContent).toBe("Анте 1 BB");
      expect(pill.querySelector("title")!.textContent).toContain("формат не указан");
      const visible = Array.from(holder.querySelectorAll("svg text")).map((node) => node.textContent).join(" ");
      expect(visible).not.toMatch(/без анте|формат не указан|старт /);
      expect(holder.querySelector("[data-pot-caption]")!.textContent).toBe("+ анте");
    }
  });

  it("trusted per-player ante (HRC assumptions: 0.1 × 9) → exact pot 'с анте' + 'Анте 0.1 BB с игрока'", () => {
    const state = resolvePreflopHandState({
      profile: ACADEMY_MTT_REFERENCE_SIZING_PROFILES[40], stackBb: 40, situation: "FACING_OPEN", heroSeat: "BB", villainSeat: "BTN",
    })!;
    const ante = resolveAnteSemantics(getAcademyPreflopRange("UTG").assumptions, 9);
    const table: AcademyPreflopTableMoney = { ...buildPreflopTableMoney(state, ante), ante };
    expect(table.pot).toEqual({ kind: "EXACT", totalBb: 4.7, anteTotalBb: 0.9 });
    expect(trainingSceneAntePresentation(table)).toMatchObject({ potCaption: "с анте", pill: "Анте 0.1 BB с игрока" });
    const holder = staticScene(publicSpot(40, "FACING_OPEN_BB_VS_BTN").scene, 40, "ADVANCED", table);
    expect(holder.querySelector("[data-table-pot]")!.textContent).toBe("Банк4.7 BBс анте");
  });

  it("no ante at all → just 'Банк X BB', no ante label", () => {
    const state = resolvePreflopHandState({ profile: ACADEMY_MTT_REFERENCE_SIZING_PROFILES[40], stackBb: 40, situation: "RFI", heroSeat: "CO" })!;
    const table = buildPreflopTableMoney(state, { kind: "NONE" });
    expect(trainingSceneAntePresentation(table)).toEqual({ potCaption: null, pill: null, note: null });
    const holder = staticScene(publicSpot(40, "RFI_CO").scene, 40, "ADVANCED", table);
    expect(holder.querySelector("[data-table-pot]")!.textContent).toBe("Банк1.5 BB");
    expect(holder.querySelector("[data-ante-note]")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (6)–(8) session: sizes, compact feedback, non-judgmental mixed answers
// ---------------------------------------------------------------------------

const mixSession = () => buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
type Q = ReturnType<typeof mixSession>[number];

function stubMixApi(all: readonly Q[]) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const question = all[body.questionIndex as number];
    const payload = url.endsWith("/session") ? toPublicPreflopTrainerQuestion(question) : toPreflopTrainerReveal(question, body.selectedAction as string);
    return { ok: true, json: async () => payload } as Response;
  }));
}

describe("(6) action buttons keep their trusted sizes in the session", () => {
  it("ADVANCED buttons show 'до X BB' / 'Колл X BB' wherever the question carries a trusted size", async () => {
    const all = mixSession();
    const index = all.findIndex((q) => toPublicPreflopTrainerQuestion(q).actions.some((action) => action.sizing));
    stubMixApi(all.map((q, i) => (i === 0 ? all[index] : q)));
    vi.stubGlobal("scrollTo", vi.fn());
    await render(<PreflopQuickMix />);
    const sized = toPublicPreflopTrainerQuestion(all[index]).actions.filter((action) => action.sizing);
    expect(sized.length).toBeGreaterThan(0);
    for (const action of sized) {
      const button = $(`button[data-action-code="${action.code}"]`)!;
      expect(button.textContent).toBe(action.sizing!.button);
      // The amount never wraps apart from "BB".
      expect(button.querySelector(".whitespace-nowrap")!.textContent).toMatch(/[\d.]+ BB$/);
    }
  });
});

describe("(7)(8) compact feedback: CTA reachable with less scrolling; valid mixed never reads as a mistake", () => {
  it("valid mixed answer: ✓ + 'засчитано' badge, summary and randomizer note in ONE paragraph, slim sticky CTA right after", async () => {
    const all = mixSession();
    const index = all.findIndex((q) => q.actions.some((a) => a.code !== q.resolvedAction && (q.frequencies[a.code] ?? 0) > 0));
    const q = all[index];
    const other = q.actions.map((a) => a.code).find((code) => code !== q.resolvedAction && (q.frequencies[code] ?? 0) > 0)!;
    stubMixApi(all.map((question, i) => (i === 0 ? q : question)));
    vi.stubGlobal("scrollTo", vi.fn());
    Element.prototype.scrollIntoView = vi.fn();
    await render(<PreflopQuickMix />);
    await click($(`button[data-action-code="${other}"]`));

    const panel = $("[data-feedback-tone]")!;
    expect(panel.getAttribute("data-feedback-tone")).toBe("valid");
    expect(panel.getAttribute("data-feedback-layout")).toBe("compact");
    expect($('[data-testid="feedback-mark"]')!.textContent).toBe("✓");
    expect($('[data-testid="feedback-counted"]')!.textContent).toBe("засчитано");
    expect(panel.className).not.toMatch(/b95b5f|5b292c/); // never the red "incorrect" look
    expect($(`button[data-action-code="${other}"]`)!.getAttribute("data-action-selected")).toBe("correct");
    // Summary + randomizer note flow in ONE paragraph (one block instead of two).
    const summary = $('[data-testid="feedback-summary"]')!;
    const note = $('[data-testid="feedback-note"]')!;
    expect(summary.parentElement).toBe(note.parentElement);
    expect(summary.parentElement!.tagName).toBe("P");
    // Two short blocks only: the title row and ONE text paragraph, which also holds "Подробнее"
    // (so the title never wraps next to it).
    expect(panel.querySelectorAll(":scope > p")).toHaveLength(2);
    expect($('[data-testid="feedback-more"]')!.parentElement).toBe(summary.parentElement);
    // Tighter box than v1 (mt-4 / p-4 / text-lg title).
    expect(panel.className).toContain("py-3");
    expect(panel.className).not.toMatch(/\bp-4\b|\bmt-4\b/);
    // The CTA: sticky, right after the feedback, a slimmer 48px button.
    const bar = $('[data-testid="trainer-next-bar"]')!;
    const next = $('[data-testid="trainer-next"]')!;
    expect(panel.nextElementSibling).toBe(bar);
    expect(bar.className).toContain("sticky");
    expect(bar.className).not.toContain("pt-4");
    expect(next.className).toContain("min-h-12");
    expect(next.className).not.toContain("min-h-14");
    expect(next.textContent).toBe("Следующая рука");
  });

  it("only a 0% answer is red; correct / valid tones never show the red classes", () => {
    const html = (tone: "correct" | "valid" | "incorrect") => renderToStaticMarkup(
      <TrainerFeedbackPanel tone={tone} title="t" summary="s" note={null} detail={null} />,
    );
    expect(html("incorrect")).toMatch(/b95b5f/);
    expect(html("correct")).not.toMatch(/b95b5f|5b292c/);
    expect(html("valid")).not.toMatch(/b95b5f|5b292c/);
    expect(html("valid")).toContain("засчитано");
    expect(html("incorrect")).not.toContain("засчитано");
  });
});

// ---------------------------------------------------------------------------
// (9) trainers landing
// ---------------------------------------------------------------------------

describe("(9) 'Тренажёры': quick → ready-made → manual", () => {
  it("three tiers in order; the preset block has every real preset; plain-Russian titles", async () => {
    await render(TrainersPage());
    const tiers = $$("[data-trainers-tier]").map((node) => node.dataset.trainersTier);
    expect(tiers).toEqual(["quick", "presets", "manual"]);
    expect($('[data-trainers-tier="quick"] [data-trainer-entry="quick-mix"]')).not.toBeNull();
    expect($('[data-trainers-tier="presets"]')!.textContent).toContain("Готовые тренировки");
    const presets = $$('[data-trainers-tier="presets"] [data-training-preset]');
    expect(presets.map((node) => node.dataset.trainingPreset)).toEqual(ACADEMY_TRAINING_PRESETS.map((preset) => preset.id));
    expect(presets.length).toBeGreaterThanOrEqual(6);
    expect($('[data-trainers-tier="manual"] [data-trainer-entry="setup"]')!.textContent).toContain("Выбрать ситуацию самому");
    // Titles carry no abbreviations / jargon; facts (stack, seats) live in small chips.
    for (const preset of ACADEMY_TRAINING_PRESETS) {
      expect(preset.title, preset.id).not.toMatch(/\b(BB|SB|BTN|CO|RFI|3-бет|Push|Fold)\b/);
    }
    const bbDefence = $('[data-training-preset="bb-defence"]')!;
    expect(bbDefence.textContent).toContain("40 BB");
    expect(bbDefence.textContent).toContain("ты: BB");
    expect(bbDefence.textContent).toContain("соперник: BTN");
    // Push/Fold stays honest: study only.
    expect($('[data-training-preset="push-fold"]')!.getAttribute("data-preset-scored")).toBe("false");
    expect($('[data-training-preset="push-fold"]')!.textContent).toContain("без оценки");
  });

  it("a preset shows real progress when the player trained it", async () => {
    mocks.progress.data = progressWith([{ code: academySpotProgressCode({ stackBb: 40, nodeKey: "FACING_OPEN_BB_VS_BTN" }), passed: true, bestScorePercent: 90, attemptsCount: 2 }]);
    await render(TrainersPage());
    expect($('[data-training-preset="bb-defence"] [data-preset-status]')!.textContent).toBe("Пройдено · 90%");
    expect($('[data-training-preset="open-raise"] [data-preset-status]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (12) advanced + Шаг 2 progress on the page
// ---------------------------------------------------------------------------

function progressWith(spots: ReadonlyArray<Pick<AcademySpotProgress, "code" | "passed" | "bestScorePercent" | "attemptsCount">>): AcademyProgressResponse {
  return {
    lessons: [],
    course: { passedLessons: 0, totalLessons: 7, progressPercent: 0 },
    courseCode: "base_mtt",
    modules: [],
    spots: spots.map((spot) => ({ ...spot, stackBb: 0, nodeKey: "" })),
  };
}

describe("(12) 'Продвинутым' shows real progress", () => {
  const codes = ACADEMY_ADVANCED_STUDY_SPOTS.map((spot) => academySpotProgressCode(spot));

  it("X из 4 from the player's spot rows; per-situation status; train + range links per card", async () => {
    mocks.progress.data = progressWith([
      { code: codes[0], passed: true, bestScorePercent: 90, attemptsCount: 3 },
      { code: codes[1], passed: false, bestScorePercent: 60, attemptsCount: 1 },
      { code: codes[2], passed: true, bestScorePercent: 100, attemptsCount: 1 },
    ]);
    await render(AdvancedPage());
    const summary = $('[data-testid="advanced-progress"]')!;
    expect(summary.textContent).toContain("2 из 4");
    expect(summary.getAttribute("data-spot-passed")).toBe("2");
    expect($$("[data-advanced-study]").map((card) => card.dataset.spotStatus)).toEqual(["passed", "started", "passed", "new"]);
    for (const spot of ACADEMY_ADVANCED_STUDY_SPOTS) {
      expect($(`[data-advanced-train="${spot.nodeKey}"]`)!.getAttribute("href"))
        .toBe(`/academy/solver/preflop/${spot.stackBb}/${spot.nodeKey.toLowerCase()}/train?from=advanced`);
      expect($(`[data-advanced-range="${spot.nodeKey}"]`)!.getAttribute("href"))
        .toBe(`/academy/solver/preflop/${spot.stackBb}/${spot.nodeKey.toLowerCase()}`);
    }
  });

  it("a fresh player sees 0 из 4 (not a fake number); unrelated catalog progress never counts", async () => {
    mocks.progress.data = { ...progressWith([]), course: { passedLessons: 7, totalLessons: 7, progressPercent: 100 } };
    await render(AdvancedPage());
    expect($('[data-testid="advanced-progress"]')!.textContent).toContain("0 из 4");
    expect($$("[data-advanced-study]").every((card) => card.dataset.spotStatus === "new")).toBe(true);
  });

  it("Шаг 2 of 'Новичкам' counts its lessons by their own practice node", async () => {
    const first = ACADEMY_BEGINNER_AFTER_OPEN_LESSONS[1];
    mocks.progress.data = progressWith([{ code: academySpotProgressCode(first.spot), passed: true, bestScorePercent: 80, attemptsCount: 1 }]);
    await render(<BeginnerPage />);
    expect($('[data-testid="step-two-progress"]')!.textContent).toContain("1 из 5");
    expect($(`[data-after-open-lesson="${first.slug}"]`)!.dataset.spotStatus).toBe("passed");
  });
});
