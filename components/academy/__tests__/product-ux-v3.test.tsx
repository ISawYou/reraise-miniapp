import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AcademyPreflopTableScene,
  AcademyPreflopTrainerReveal,
  AcademySolverPublicAction,
  RenderedPlayingCard,
} from "@/types/academy";

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
  useAcademyProgress: () => ({ data: null, error: null, retry: () => {} }),
}));

const { default: AcademyPage } = await import("@/app/academy/page");
const { default: BeginnerPage } = await import("@/app/academy/beginner/page");
const { default: IntermediatePage } = await import("@/app/academy/intermediate/page");
const { default: AdvancedPage } = await import("@/app/academy/advanced/page");
const { default: TrainersPage } = await import("@/app/academy/trainers/page");
const { default: PreflopModulePage } = await import("@/app/academy/preflop/page");
const { default: PreflopLessonPage } = await import("@/app/academy/preflop/[position]/page");
const { default: PreflopLessonTrainPage } = await import("@/app/academy/preflop/[position]/train/page");
const { default: RfiModulePage } = await import("@/app/academy/solver/rfi/100bb/page");
const { default: RfiLessonPage } = await import("@/app/academy/solver/rfi/100bb/[position]/page");
const { default: RfiLessonTrainPage } = await import("@/app/academy/solver/rfi/100bb/[position]/train/page");
const { default: PreflopTrainerHomePage } = await import("@/app/academy/solver/preflop/page");
const { default: PreflopMixPage } = await import("@/app/academy/solver/preflop/mix/page");
const { default: PreflopSpotPage } = await import("@/app/academy/solver/preflop/[stack]/[node]/page");
const { default: PreflopSpotTrainPage } = await import("@/app/academy/solver/preflop/[stack]/[node]/train/page");
const { default: PushFoldHomePage } = await import("@/app/academy/solver/push-fold/page");
const { default: PushFoldMixPage } = await import("@/app/academy/solver/push-fold/mix/page");
const { default: PushFoldSpotPage } = await import("@/app/academy/solver/push-fold/[stack]/[node]/page");
const { default: PushFoldSpotTrainPage } = await import("@/app/academy/solver/push-fold/[stack]/[node]/train/page");
const { PokerPositionTable, trainingSceneSlotOf } = await import("@/components/academy/poker-position-table");
const { PreflopTrainer, PreflopQuickMix } = await import("@/components/academy/preflop-trainer");
const { PushFoldTrainer } = await import("@/components/academy/push-fold-trainer");
const { PreflopTrainerHome } = await import("@/components/academy/preflop-trainer-home");
const {
  ACADEMY_ADDITIONAL_PRACTICE_ACTIVITIES,
  ACADEMY_PRACTICE_ACTIVITIES,
  ACADEMY_CATALOG,
  listAllAcademyLessonCodes,
} = await import("@/config/academy/catalog");
const { ACADEMY_ADVANCED_STUDY_SPOTS, ACADEMY_DESTINATIONS, ACADEMY_TRAINER_ENTRIES } = await import("@/config/academy/navigation");
const { ACADEMY_PREFLOP_POSITIONS } = await import("@/lib/academy/preflop");
const {
  buildAcademyPreflopTrainerSession,
  listAcademyPreflopTrainerSpots,
  toPreflopTrainerReveal,
  toPublicPreflopTrainerQuestion,
  toPublicPreflopTrainerSpot,
} = await import("@/lib/academy/preflop-trainer");
const { buildAcademyPreflopMixSession } = await import("@/lib/academy/preflop-mix");
const { getPushFoldSpotScene, listAcademyPushFoldSpots } = await import("@/lib/academy/push-fold-trainer");

const PLAYER_ID = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_ID = "44444444-4444-4444-8444-444444444444";

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

const $ = (selector: string) => container.querySelector(selector);
const $$ = (selector: string) => Array.from(container.querySelectorAll<HTMLElement>(selector));
const hrefs = () => $$("a").map((link) => link.getAttribute("href"));
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv("SESSION_SECRET", "product-ux-v3-secret");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.location.hash = "";
});

// ---------------------------------------------------------------------------
// (1)(2) Landing
// ---------------------------------------------------------------------------

describe("(1)(2) /academy landing", () => {
  it("shows the four plain destinations — learn levels and a separate Тренажёры", async () => {
    await render(<AcademyPage />);
    const cards = $$("[data-destination]");
    expect(cards.map((card) => [card.dataset.destination, card.getAttribute("href")])).toEqual([
      ["beginner", "/academy/beginner"],
      ["intermediate", "/academy/intermediate"],
      ["advanced", "/academy/advanced"],
      ["trainers", "/academy/trainers"],
    ]);
    for (const [code, title, description] of [
      ["beginner", "Новичкам", "Освой позиции и базовую игру на префлопе"],
      ["intermediate", "Продолжающим", "Научись лучше понимать диапазоны и решения по позициям"],
      ["advanced", "Продвинутым", "Разбирай сложные ситуации и смешанные стратегии"],
      ["trainers", "Тренажёры", "Практикуй решения за столом"],
    ]) {
      const card = $(`[data-destination="${code}"]`)!;
      expect(card.textContent).toContain(title);
      expect(card.textContent).toContain(description);
    }
    // Trainers is its own section, not one of the learning levels.
    const learn = $('section[aria-labelledby="academy-learn-heading"]')!;
    const practice = $('section[aria-labelledby="academy-practice-heading"]')!;
    expect(learn.querySelector('[data-destination="trainers"]')).toBeNull();
    expect(practice.querySelector('[data-destination="trainers"]')).not.toBeNull();
  });

  it("uses no technical architecture terms as landing copy", async () => {
    await render(<AcademyPage />);
    expect(container.textContent).not.toMatch(/Solver Lab|солвер|\bMTT\b|\bRFI\b|BB defen[cs]e|mixed frequenc|\bHRC\b|\bGTO\b|База MTT/i);
  });
});

// ---------------------------------------------------------------------------
// Destination pages map onto existing content only
// ---------------------------------------------------------------------------

describe("destination pages (existing content, existing URLs)", () => {
  it("(3) Новичкам lists the seven existing basic lessons at their existing URLs", async () => {
    await render(<BeginnerPage />);
    expect(hrefs().filter((href) => href?.startsWith("/academy/preflop/"))).toEqual(
      ACADEMY_PREFLOP_POSITIONS.map((position) => `/academy/preflop/${position.toLowerCase()}`),
    );
    expect(hrefs()).toContain("/academy/trainers");
    expect(hrefs()).toContain("/academy");
  });

  it("(3) Продолжающим lists the seven existing HRC 100 BB lessons at their existing URLs", async () => {
    await render(<IntermediatePage />);
    expect(hrefs().filter((href) => href?.startsWith("/academy/solver/rfi/100bb/"))).toEqual(
      ACADEMY_PREFLOP_POSITIONS.map((position) => `/academy/solver/rfi/100bb/${position.toLowerCase()}`),
    );
    expect(container.textContent).not.toMatch(/Solver Lab/);
  });

  it("Продвинутым links only to REAL spot study pages (every curated spot resolves and renders)", async () => {
    await render(AdvancedPage());
    const studies = $$("[data-advanced-study]");
    expect(studies).toHaveLength(ACADEMY_ADVANCED_STUDY_SPOTS.length);
    for (const entry of ACADEMY_ADVANCED_STUDY_SPOTS) {
      const href = `/academy/solver/preflop/${entry.stackBb}/${entry.nodeKey.toLowerCase()}`;
      expect(hrefs()).toContain(href);
      const element = await PreflopSpotPage(params({ stack: String(entry.stackBb), node: entry.nodeKey.toLowerCase() }));
      expect(renderToStaticMarkup(element)).toContain('data-testid="range-view"');
    }
    expect(hrefs()).toContain("/academy/solver/preflop#setup");
  });

  it("(2) Тренажёры presents every registered practice activity by goal, linking to the existing trainer routes", async () => {
    await render(TrainersPage());
    const entries = $$("[data-trainer-entry]").map((entry) => entry.dataset.trainerEntry);
    expect(entries).toEqual(["quick-mix", "setup", "push-fold-reference"]);
    expect($$("[data-trainer-link]").map((link) => [link.dataset.trainerLink, link.getAttribute("href")])).toEqual([
      ["quick-mix", "/academy/solver/preflop/mix"],
      ["setup", "/academy/solver/preflop#setup"],
      ["push-fold-reference", "/academy/solver/push-fold"],
    ]);
    for (const title of ["Быстрая тренировка", "Выбрать ситуацию", "Короткий стек"]) {
      expect(container.textContent).toContain(title);
    }
    // Part 1A: the short-stack entry is an honest, non-scored reference.
    expect(container.textContent).not.toContain("Быстрая Push/Fold тренировка");
    expect($('[data-trainer-link="push-fold-reference"]')!.textContent).toContain("без оценки");
    // Same practice lesson codes as the catalog registers — no new identity.
    const registered = [...ACADEMY_PRACTICE_ACTIVITIES, ...ACADEMY_ADDITIONAL_PRACTICE_ACTIVITIES].map((activity) => activity.lesson.code);
    expect(new Set(ACADEMY_TRAINER_ENTRIES.map((entry) => entry.practiceLessonCode))).toEqual(new Set(registered));
    expect($('[data-testid="push-fold-attribution"]')?.textContent).toContain("Данные Push/Fold: HoldemMath · CC BY 4.0");
  });

  it("navigation is presentation-only: catalog structure and lesson codes are unchanged", () => {
    expect(ACADEMY_CATALOG.map((course) => course.code)).toEqual(["base_mtt", "solver_lab"]);
    expect(listAllAcademyLessonCodes()).toHaveLength(14);
    for (const destination of ACADEMY_DESTINATIONS) {
      if (destination.courseCode) expect(ACADEMY_CATALOG.map((course) => course.code)).toContain(destination.courseCode);
    }
  });
});

// ---------------------------------------------------------------------------
// (4) Every existing Academy URL still resolves
// ---------------------------------------------------------------------------

describe("(4) every existing Academy URL still resolves", () => {
  it.each([
    ["/academy/preflop", async () => <PreflopModulePage />],
    ["/academy/preflop/utg", () => PreflopLessonPage(params({ position: "utg" }))],
    ["/academy/preflop/btn/train", () => PreflopLessonTrainPage(params({ position: "btn" }))],
    ["/academy/solver/rfi/100bb", async () => <RfiModulePage />],
    ["/academy/solver/rfi/100bb/co", () => RfiLessonPage(params({ position: "co" }))],
    ["/academy/solver/rfi/100bb/co/train", () => RfiLessonTrainPage(params({ position: "co" }))],
    ["/academy/solver/preflop", async () => PreflopTrainerHomePage()],
    ["/academy/solver/preflop/mix", async () => <PreflopMixPage />],
    ["/academy/solver/preflop/40/facing_3bet_utg_vs_sb", () => PreflopSpotPage(params({ stack: "40", node: "facing_3bet_utg_vs_sb" }))],
    ["/academy/solver/preflop/40/facing_3bet_utg_vs_sb/train", () => PreflopSpotTrainPage(params({ stack: "40", node: "facing_3bet_utg_vs_sb" }))],
    ["/academy/solver/push-fold", async () => PushFoldHomePage()],
    ["/academy/solver/push-fold/mix", async () => <PushFoldMixPage />],
    ["/academy/solver/push-fold/10/first_in_shove_btn", () => PushFoldSpotPage(params({ stack: "10", node: "first_in_shove_btn" }))],
    ["/academy/solver/push-fold/10/first_in_shove_btn/train", () => PushFoldSpotTrainPage(params({ stack: "10", node: "first_in_shove_btn" }))],
    ["/academy (new)", async () => <AcademyPage />],
    ["/academy/beginner (new)", async () => <BeginnerPage />],
    ["/academy/intermediate (new)", async () => <IntermediatePage />],
    ["/academy/advanced (new)", async () => AdvancedPage()],
    ["/academy/trainers (new)", async () => TrainersPage()],
  ] as const)("%s", async (_route, load) => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const element = await load();
    expect(element).toBeTruthy();
    await render(element as ReactElement);
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// (5)(6)(7) TRAINING_SCENE: bigger, same semantics, nothing fabricated, no collisions
// ---------------------------------------------------------------------------

type Box = { x: number; y: number; w: number; h: number; what: string };

function sceneBoxes(scene: AcademyPreflopTableScene, stackBb?: number) {
  const holder = document.createElement("div");
  holder.innerHTML = renderToStaticMarkup(<PokerPositionTable mode="TRAINING_SCENE" scene={scene} stackBb={stackBb} />);
  const box = (node: Element, what: string): Box => {
    const [x, y] = node.getAttribute("transform")!.match(/translate\(([-\d.]+) ([-\d.]+)\)/)!.slice(1).map(Number);
    const rect = node.querySelector("rect")!;
    return { x, y, w: Number(rect.getAttribute("width")), h: Number(rect.getAttribute("height")), what };
  };
  const plates = Array.from(holder.querySelectorAll("[data-table-seat]")).map((node) => box(node, `plate ${node.getAttribute("data-table-seat")}`));
  const chips = Array.from(holder.querySelectorAll("[data-seat-action]")).map((node) => box(node, `chip ${node.getAttribute("data-seat-action")}`));
  return { holder, plates, chips };
}

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Hero-cards area on the felt (viewBox units): two 56px cards + gap, from HERO_CARDS_TOP. */
const HERO_CARDS_AREA: Box = { x: 180 - 59, y: 242, w: 118, h: 80, what: "hero cards" };

describe("(5) TRAINING_SCENE is a materially larger, phone-shaped table", () => {
  it("portrait seat view: 360×384 vs the 360×230 lesson table (1.67× taller at the same width)", () => {
    const scene = toPublicPreflopTrainerSpot(listAcademyPreflopTrainerSpots()[0]).scene;
    const training = document.createElement("div");
    training.innerHTML = renderToStaticMarkup(<PokerPositionTable mode="TRAINING_SCENE" scene={scene} stackBb={40} />);
    const lesson = document.createElement("div");
    lesson.innerHTML = renderToStaticMarkup(<PokerPositionTable activePosition="UTG" />);
    const viewBox = (holder: HTMLElement) => holder.querySelector("svg")!.getAttribute("viewBox")!.split(" ").map(Number);
    const [, , tw, th] = viewBox(training);
    const [, , lw, lh] = viewBox(lesson);
    expect(tw).toBe(lw);
    expect(th / lh).toBeGreaterThan(1.6);
    expect(training.querySelector("[data-scene-layout]")?.getAttribute("data-scene-layout")).toBe("SEAT_VIEW");
    // The felt itself: 246×302 units vs the old 206×124 felt.
    const felt = training.querySelectorAll("ellipse")[1];
    expect(Number(felt.getAttribute("rx")) * 2).toBeGreaterThanOrEqual(240);
    expect(Number(felt.getAttribute("ry")) * 2).toBeGreaterThanOrEqual(300);
  });

  it("in a session the scene spans the full content width (no 320px cap) and carries the hero's cards on the felt", async () => {
    const session = buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => toPublicPreflopTrainerQuestion(session[0]) }) as Response));
    await render(<PreflopQuickMix />);
    const sceneWrapper = $('[data-testid="hand-scene"]')!;
    expect(sceneWrapper.className).not.toMatch(/max-w-\[/);
    expect(sceneWrapper.closest(".max-w-md")).not.toBeNull();
    const cards = $('[data-testid="scene-hero-cards"] [aria-label^="Рука "]')!;
    expect(cards.getAttribute("aria-label")).toBe(`Рука ${session[0].hand}`);
    expect(cards.closest('[data-table-mode="TRAINING_SCENE"]')).not.toBeNull();
    // Order: context → table (with cards) → "Твой ход" → buttons.
    const order = ['[data-testid="spot-facts"]', '[data-table-mode="TRAINING_SCENE"]', '[data-testid="your-move"]', "[data-action-count]"].map((s) => $(s)!);
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

describe("(6)(7) scene semantics preserved for EVERY real spot; no fabricated labels; no collisions", () => {
  const allScenes: Array<[string, AcademyPreflopTableScene, number]> = [
    ...listAcademyPreflopTrainerSpots().map((spot) => [`preflop ${spot.stackBb} ${spot.nodeKey}`, toPublicPreflopTrainerSpot(spot).scene, spot.stackBb] as [string, AcademyPreflopTableScene, number]),
    ...listAcademyPushFoldSpots().map((spot) => [`push-fold ${spot.stackBb} ${spot.nodeKey}`, getPushFoldSpotScene(spot), spot.stackBb] as [string, AcademyPreflopTableScene, number]),
  ];

  it(`renders exactly the builder's labels and roles, hero bottom-centre, readable layout (${allScenes.length} scenes)`, () => {
    expect(allScenes.length).toBeGreaterThan(400);
    for (const [name, scene, stackBb] of allScenes) {
      const { holder, plates, chips } = sceneBoxes(scene, stackBb);
      // (7) chips == exactly what the scene builder derived (role + label) for the hero and
      // the villain, nothing else. v2: folded seats carry the builder's role on their quiet
      // plate but get NO chip (no "Фолд" smeared around the table).
      const rendered = Object.fromEntries(Array.from(holder.querySelectorAll<HTMLElement>("[data-seat-action]"))
        .map((node) => [node.dataset.seatAction, `${node.dataset.seatRole}:${node.textContent}`]));
      const expected = Object.fromEntries(scene.seats.filter((seat) => seat.actionLabel && (seat.role === "hero" || seat.role === "villain"))
        .map((seat) => [seat.seat, `${seat.role}:${seat.actionLabel}`]));
      expect(rendered, name).toEqual(expected);
      for (const seat of scene.seats) {
        expect(holder.querySelector(`[data-table-seat="${seat.seat}"]`)?.getAttribute("data-scene-role"), `${name} ${seat.seat}`).toBe(seat.role);
      }
      expect(holder.textContent, name).not.toContain("Фолд");
      // (6) hero / villain identity as before.
      expect(holder.querySelector(`[data-table-seat="${scene.heroSeat}"]`)?.getAttribute("aria-label"), name).toBe(`${scene.heroSeat}, ты`);
      expect(holder.querySelector(`[data-table-seat="${scene.heroSeat}"] rect`)?.getAttribute("fill"), name).toBe("#d7b55a");
      if (scene.villainSeat) {
        expect(holder.querySelector(`[data-table-seat="${scene.villainSeat}"]`)?.getAttribute("aria-label"), name).toBe(`${scene.villainSeat}, соперник`);
      }
      expect(holder.querySelector('[role="img"]')?.getAttribute("aria-label"), name).toContain(`Ты на ${scene.heroSeat}`);
      // Hero sits at the bottom centre, all nine seats visible, one dealer button.
      const hero = plates.find((plate) => plate.what === `plate ${scene.heroSeat}`)!;
      expect(hero.x + hero.w / 2, name).toBe(180);
      expect(Math.max(...plates.map((plate) => plate.y + plate.h)), name).toBe(hero.y + hero.h);
      expect(plates, name).toHaveLength(9);
      expect(holder.querySelectorAll("[data-dealer-button]"), name).toHaveLength(1);
      // Readable: no chip overlaps a plate, another chip or the hero-cards area; all inside the viewBox.
      for (const chip of chips) {
        expect(chip.x >= 0 && chip.y >= 0 && chip.x + chip.w <= 360 && chip.y + chip.h <= 384, `${name} ${chip.what}`).toBe(true);
        expect(overlap(chip, HERO_CARDS_AREA), `${name} ${chip.what} vs cards`).toBe(false);
        for (const other of [...plates, ...chips]) {
          if (other !== chip) expect(overlap(chip, other), `${name} ${chip.what} vs ${other.what}`).toBe(false);
        }
      }
      for (const plate of plates) {
        for (const other of plates) if (other !== plate) expect(overlap(plate, other), `${name} ${plate.what} vs ${other.what}`).toBe(false);
        if (plate !== hero) expect(overlap(plate, HERO_CARDS_AREA), `${name} ${plate.what} vs cards`).toBe(false);
      }
    }
  });

  it("slot order is clockwise action order starting at the hero", () => {
    expect(trainingSceneSlotOf("CO", "CO")).toBe(0);
    expect(trainingSceneSlotOf("BTN", "CO")).toBe(1);
    expect(trainingSceneSlotOf("HJ", "CO")).toBe(8);
    expect(trainingSceneSlotOf("UTG", "BB")).toBe(1);
  });

  it("B1 example: 40 BB, UTG opens, SB 3-bets — 'Ты' + 'Рейз' on UTG, '3-бет' on SB, the rest folded quietly (no chips)", () => {
    const spot = listAcademyPreflopTrainerSpots().find((candidate) => candidate.stackBb === 40 && candidate.nodeKey === "FACING_3BET_UTG_VS_SB")!;
    const scene = toPublicPreflopTrainerSpot(spot).scene;
    const { holder } = sceneBoxes(scene, 40);
    expect(holder.querySelector('[data-table-seat="UTG"]')!.textContent).toBe("UTGТы");
    expect(holder.querySelector('[data-seat-action="UTG"]')!.textContent).toBe("Рейз");
    expect(holder.querySelector('[data-table-seat="SB"]')!.textContent).toBe("SBСоперник");
    expect(holder.querySelector('[data-seat-action="SB"]')!.textContent).toBe("3-бет");
    for (const seat of ["UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "BB"]) {
      expect(holder.querySelector(`[data-table-seat="${seat}"]`)!.getAttribute("data-scene-role")).toBe("folded");
      expect(holder.querySelector(`[data-table-seat="${seat}"] rect`)!.getAttribute("fill")).toBe("#0d1210");
      expect(holder.querySelector(`[data-table-seat="${seat}"]`)!.getAttribute("data-seat-folded")).toBe("true");
      expect(holder.querySelector(`[data-seat-action="${seat}"]`)).toBeNull();
    }
    expect(holder.textContent).toContain("40 BB");
  });
});

// ---------------------------------------------------------------------------
// (8) Completion screens: clear next steps, no dead end, review from session data
// ---------------------------------------------------------------------------

type AnyQuestion = {
  readonly questionIndex: number;
  readonly resolvedAction: string;
  readonly frequencies: Record<string, number>;
  readonly actions: readonly AcademySolverPublicAction[];
  readonly hand: string;
  readonly renderedCards: readonly [RenderedPlayingCard, RenderedPlayingCard];
};

async function playSession<Q extends AnyQuestion>({
  element,
  session,
  publicQuestion,
  reveal,
  wrong,
  choose,
}: {
  element: ReactElement;
  session: readonly Q[];
  publicQuestion: (question: Q) => unknown;
  reveal: (question: Q, selectedAction: string) => unknown;
  wrong?: ReadonlySet<number>;
  /** Optional explicit choice per question (defaults: `wrong` → another action, else the resolved one). */
  choose?: (question: Q) => string;
}) {
  const submitted: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    let payload: unknown;
    if (url.endsWith("/session")) payload = publicQuestion(session[body.questionIndex as number]);
    else if (url.endsWith("/reveal")) payload = reveal(session[body.questionIndex as number], body.selectedAction as string);
    else {
      submitted.push(body);
      const answers = body.questions as Array<{ questionIndex: number; selectedAction: string }>;
      // Mirrors the server's normal-practice rule: any action with frequency > 0 is correct.
      const correct = answers.filter((answer) => (session[answer.questionIndex].frequencies[answer.selectedAction] ?? 0) > 0).length;
      payload = {
        result: { correctAnswers: correct, totalQuestions: 10, percentage: correct * 10, passed: correct >= 8, feedback: "Готово" },
        progress: { lessonCode: body.lessonCode, attemptsCount: 3 }, isNewAttempt: true, firstPass: false, newBest: false,
      };
    }
    return { ok: true, json: async () => payload } as Response;
  }));
  await render(element);
  for (const question of session) {
    const choice = choose
      ? choose(question)
      : wrong?.has(question.questionIndex)
        ? question.actions.find((action) => action.code !== question.resolvedAction)!.code
        : question.resolvedAction;
    await click($(`button[data-action-code="${choice}"]`));
    await click($$("button").find((button) => /Следующая рука|Посмотреть результат/.test(button.textContent ?? "")));
  }
  return submitted;
}

function expectCompletionNavigation({ setupHref, extra }: { setupHref: string; extra?: string }) {
  const screen = $('[data-testid="trainer-completion"]')!;
  expect(screen).not.toBeNull();
  expect(screen.textContent).toContain("Тренировка завершена");
  const restart = $('[data-completion-action="restart"]')!;
  expect(restart.tagName).toBe("BUTTON");
  expect(restart.textContent).toBe("Пройти ещё раз");
  const trainers = $('[data-completion-action="trainers"]')!;
  expect(trainers.textContent).toBe("К тренажёрам");
  expect(trainers.getAttribute("href")).toBe("/academy/trainers");
  // Primary comes before secondary.
  expect(restart.compareDocumentPosition(trainers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect($('[data-completion-action="setup"]')?.getAttribute("href")).toBe(setupHref);
  if (extra) expect(hrefs()).toContain(extra);
  // A back link is always there (no dead end).
  expect(screen.querySelector("a")?.textContent).toMatch(/Назад|Тренажёры|К выбору ситуации/);
}

async function expectReview(expectedWrong: readonly number[]) {
  if (expectedWrong.length === 0) {
    expect($('[data-completion-action="review"]')).toBeNull();
    expect($('[data-testid="trainer-review-empty"]')).not.toBeNull();
    return;
  }
  const toggle = $('[data-completion-action="review"]')!;
  expect(toggle.textContent).toContain(`Разобрать ошибки · ${expectedWrong.length}`);
  expect($('[data-testid="trainer-review"]')).toBeNull();
  await click(toggle);
  expect($$("[data-review-question]").map((entry) => Number(entry.dataset.reviewQuestion))).toEqual(expectedWrong.map((index) => index + 1));
  for (const entry of $$("[data-review-question]")) {
    expect(entry.textContent).toContain("Твой ответ:");
  }
}

async function expectRestartResets() {
  await click($('[data-completion-action="restart"]'));
  expect($('[data-testid="trainer-completion"]')).toBeNull();
  expect(container.textContent).toContain("1 из 10");
}

const WRONG = new Set([1, 4, 7]);

describe("(8) completion screens", () => {
  it("configurable preflop trainer (fixed node): only 0% actions are reviewed; valid mixed choices are a neutral note", async () => {
    const selection = { datasetId: "external_mtt_preflop_9max_40bb_v1", nodeKey: "FACING_3BET_UTG_VS_SB", stackBb: 40 };
    const session = buildAcademyPreflopTrainerSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId: selection.datasetId, nodeKey: selection.nodeKey });
    // Mixed hands → pick a DIFFERENT action the strategy also plays (valid mixed);
    // WRONG indices → pick a 0% action when the hand has one.
    const zeroAction = (question: (typeof session)[number]) =>
      question.actions.find((action) => (question.frequencies[action.code] ?? 0) === 0)?.code;
    const validOther = (question: (typeof session)[number]) =>
      question.actions.find((action) => action.code !== question.resolvedAction && (question.frequencies[action.code] ?? 0) > 0)?.code;
    const choices = session.map((question) =>
      (WRONG.has(question.questionIndex) ? zeroAction(question) : undefined) ?? validOther(question) ?? question.resolvedAction);
    const expectedWrong = session.filter((question, index) => (question.frequencies[choices[index]] ?? 0) === 0).map((question) => question.questionIndex);
    const expectedValidMixed = session.filter((question, index) =>
      choices[index] !== question.resolvedAction && (question.frequencies[choices[index]] ?? 0) > 0).length;
    expect(expectedWrong.length).toBeGreaterThan(0);
    expect(expectedValidMixed).toBeGreaterThan(0);
    const submitted = await playSession({
      element: <PreflopTrainer selection={selection} />,
      session,
      publicQuestion: toPublicPreflopTrainerQuestion,
      reveal: (question, selectedAction) => toPreflopTrainerReveal(question, selectedAction) satisfies AcademyPreflopTrainerReveal,
      choose: (question) => choices[question.questionIndex],
    });
    expect(submitted).toHaveLength(1);
    expect(container.textContent).toContain(`${10 - expectedWrong.length} / 10`);
    expectCompletionNavigation({ setupHref: "/academy/solver/preflop#setup", extra: "/academy/solver/preflop/40/facing_3bet_utg_vs_sb" });
    expect($('[data-testid="trainer-valid-mixed-note"]')!.textContent).toContain("отличал");
    expect($('[data-testid="trainer-valid-mixed-note"]')!.textContent).toContain("входил");
    expect($('[data-testid="trainer-valid-mixed-note"]')!.textContent).not.toMatch(/ошибк/i);
    await expectReview(expectedWrong);
    for (const entry of $$("[data-review-question]")) expect(entry.dataset.reviewTone).toBe("incorrect");
    await expectRestartResets();
  });

  it("Preflop Quick Mix", async () => {
    const session = buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    await playSession({
      element: <PreflopQuickMix />,
      session,
      publicQuestion: toPublicPreflopTrainerQuestion,
      reveal: (question, selectedAction) => toPreflopTrainerReveal(question, selectedAction) satisfies AcademyPreflopTrainerReveal,
      wrong: new Set(),
    });
    expectCompletionNavigation({ setupHref: "/academy/solver/preflop#setup" });
    expect($('[data-testid="trainer-completion"] a')!.getAttribute("href")).toBe("/academy/trainers");
    await expectReview([]);
    await expectRestartResets();
  });

  // The Push/Fold manual / Quick completion screens run only once a dataset is
  // validated for scored training (Part 1A); they are covered against a
  // simulated validated whitelist in push-fold-scored-ui.test.tsx.

  it("in-session back links lead to the right place (quick → Тренажёры, fixed → the picker)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    await render(<PreflopQuickMix />);
    expect($('[data-testid="trainer-back"]')!.getAttribute("href")).toBe("/academy/trainers");
    await render(<PushFoldTrainer selection={{ datasetId: "holdemmath_pushfold_9max_10bb_ante10_v1", nodeKey: "FIRST_IN_SHOVE_BTN", stackBb: 10 }} />);
    expect($('[data-testid="trainer-back"]')!.getAttribute("href")).toBe("/academy/solver/push-fold#setup");
  });
});

describe("Настроить ситуацию deep link", () => {
  it("opens the manual picker on arrival only when the link asks for it (#setup)", async () => {
    const spots = listAcademyPreflopTrainerSpots();
    await render(<PreflopTrainerHome spots={spots} />);
    expect($('[data-testid="preflop-trainer-setup"]')).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    window.location.hash = "#setup";
    await render(<PreflopTrainerHome spots={spots} />);
    expect($('[data-testid="manual-toggle"]')!.getAttribute("aria-expanded")).toBe("true");
    expect($('[data-testid="preflop-trainer-setup"]')).not.toBeNull();
    await click($('[data-testid="manual-toggle"]'));
    expect($('[data-testid="preflop-trainer-setup"]')).toBeNull();
  });
});
