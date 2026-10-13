import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACADEMY_TABLE_SEATS, getAcademyTableSeat } from "@/config/academy/position-table";
import type { AcademyPreflopTrainerReveal, PreflopPosition } from "@/types/academy";

const mocks = vi.hoisted(() => ({ push: vi.fn(), linkClick: vi.fn() }));

// Server page access gate: this suite renders the pages as a FULL-access player
// (the gate itself is covered by components/academy/__tests__/academy-access-pages.test.tsx).
vi.mock("@/components/academy/academy-page-access-gate", () => ({
  AcademyPageAccessGate: ({ children }: { children: unknown }) => children,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/academy/solver/preflop",
  useRouter: () => ({ back: vi.fn(), push: mocks.push, replace: vi.fn() }),
}));

// Stand-in for Next's client-side navigation: a real <a href>, whose click is
// intercepted like next/link does.
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children?: ReactNode; onClick?: (event: unknown) => void } & Record<string, unknown>) => (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
        mocks.linkClick(href);
      }}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/components/academy/use-academy-progress", () => ({
  useAcademyProgress: () => ({ data: null, error: null, retry: () => {} }),
}));

const { PokerPositionTable } = await import("@/components/academy/poker-position-table");
const { PreflopTrainerSetup } = await import("@/components/academy/preflop-trainer-setup");
const { default: SetupPage } = await import("@/app/academy/solver/preflop/page");
const { default: MixPage } = await import("@/app/academy/solver/preflop/mix/page");
const { default: SpotPage } = await import("@/app/academy/solver/preflop/[stack]/[node]/page");
const { default: AcademyLessonPage } = await import("@/app/academy/preflop/[position]/page");
const { buildAcademyPreflopMixSession } = await import("@/lib/academy/preflop-mix");
const {
  listAcademyPreflopTrainerSpots,
  requireAcademyPreflopTrainerSpotByStack,
  toPreflopTrainerReveal,
  toPublicPreflopTrainerQuestion,
  toPublicPreflopTrainerSpot,
} = await import("@/lib/academy/preflop-trainer");

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";

let container: HTMLDivElement;
let root: Root;
const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

async function render(element: ReactElement) {
  await act(async () => {
    root.render(element);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function click(element: Element | null) {
  if (!element) throw new Error("element not found");
  await act(async () => {
    (element as HTMLElement).click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function key(element: Element, value: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
  });
}

const $ = (selector: string) => container.querySelector(selector);
const $$ = (selector: string) => Array.from(container.querySelectorAll<HTMLElement>(selector));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv("SESSION_SECRET", "preflop-ux-v2-secret");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  requests.length = 0;
  mocks.push.mockReset();
  mocks.linkClick.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("(1) preflop trainer home", () => {
  // Product UX v3: "Настроить спот" is now worded "Настроить ситуацию".
  it("exposes 'Быстрая тренировка' and 'Настроить ситуацию' as distinct, labelled entry points", async () => {
    await render(SetupPage());
    const quick = $('[data-entry="quick-mix"]')!;
    const manual = $('[data-entry="manual"]')!;
    expect(quick).not.toBeNull();
    expect(manual).not.toBeNull();
    expect(quick.textContent).toContain("Быстрая тренировка");
    expect(quick.textContent).toContain("10 случайных решений из разных стеков и ситуаций");
    expect(quick.querySelector('[data-testid="quick-mix-start"]')!.getAttribute("href")).toBe("/academy/solver/preflop/mix");
    expect(quick.querySelector('[data-testid="quick-mix-start"]')!.textContent).toBe("Начать");
    expect(manual.textContent).toContain("Настроить ситуацию");
    expect(manual.textContent).toContain("Выбери стек, ситуацию и позиции сам");
    // Quick Mix comes first; the manual picker is not forced on arrival.
    expect(quick.compareDocumentPosition(manual) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect($('[data-testid="preflop-trainer-setup"]')).toBeNull();
    const toggle = $('[data-testid="manual-toggle"]')!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect($('[data-testid="preflop-trainer-setup"]')).not.toBeNull();
  });
});

describe("(2)(3) Quick Mix session UI", () => {
  it("starts with one API call and no configuration; a full session is 10 questions; answers echo server nodes", async () => {
    const session = buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      requests.push({ url, body });
      let payload: unknown;
      if (url.endsWith("/mix/session")) {
        payload = toPublicPreflopTrainerQuestion(session[body.questionIndex as number]);
      } else if (url.endsWith("/mix/reveal")) {
        const question = session[body.questionIndex as number];
        payload = toPreflopTrainerReveal(question, body.selectedAction as string) satisfies AcademyPreflopTrainerReveal;
      } else {
        payload = {
          result: { correctAnswers: 10, totalQuestions: 10, percentage: 100, passed: true, feedback: "Отлично" },
          progress: { lessonCode: "solver_preflop_trainer", attemptsCount: 1 }, isNewAttempt: true, firstPass: true, newBest: true,
        };
      }
      return { ok: true, json: async () => payload } as Response;
    }));

    await render(<MixPage />);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/academy/solver/preflop/mix/session");
    expect(Object.keys(requests[0].body).sort()).toEqual(["attemptId", "questionIndex"]);
    expect(requests[0].body.questionIndex).toBe(0);
    // First question: table scene + "Твой ход" + real action buttons, nothing answer-revealing.
    expect($('[data-table-mode="TRAINING_SCENE"]')).not.toBeNull();
    expect($('[data-testid="your-move"]')!.textContent).toBe("Твой ход");
    expect($$("button[data-action-code]").map((button) => button.dataset.actionCode)).toEqual(session[0].actions.map((a) => a.code));
    expect(container.textContent).not.toMatch(/%/);

    for (let index = 0; index < 10; index += 1) {
      expect(container.textContent).toContain(`${index + 1} из 10`);
      await click($(`button[data-action-code="${session[index].resolvedAction}"]`));
      expect(requests.at(-1)!.url).toBe("/api/academy/solver/preflop/mix/reveal");
      expect(Object.keys(requests.at(-1)!.body).sort()).toEqual(["attemptId", "questionIndex", "selectedAction"]);
      expect($("[data-feedback-tone]")).not.toBeNull();
      await click(Array.from(container.querySelectorAll("button")).find((button) =>
        /Следующая рука|Посмотреть результат/.test(button.textContent ?? "")) ?? null);
    }

    const submit = requests.find((request) => request.url === "/api/academy/attempts")!;
    expect(submit.body.lessonCode).toBe("solver_preflop_trainer");
    const answers = submit.body.questions as Array<Record<string, unknown>>;
    expect(answers).toHaveLength(10);
    answers.forEach((answer, index) => {
      expect(answer).toEqual({
        questionIndex: index, selectedAction: session[index].resolvedAction, mode: "QUICK_MIX",
        datasetId: session[index].spot.datasetId, nodeKey: session[index].spot.nodeKey,
      });
    });
    expect(new Set(answers.map((answer) => answer.nodeKey)).size).toBeGreaterThan(1);
    expect(container.textContent).toContain("Тренировка завершена");
  });
});

describe("(12)(13) TRAINING_SCENE table", () => {
  const sceneOf = (stackBb: number, nodeKey: string) => toPublicPreflopTrainerSpot(requireAcademyPreflopTrainerSpotByStack(stackBb, nodeKey).spot).scene;
  const bubbles = () => Object.fromEntries($$("[data-seat-action]").map((node) => [node.dataset.seatAction, `${node.dataset.seatRole}:${node.textContent}`]));
  /** v2: folded seats are quiet plates (role "folded", no action chip, no "Фолд" text). */
  const foldedSeats = () => $$("[data-table-seat][data-scene-role=folded]").map((node) => node.dataset.tableSeat);

  it("RFI node: hero highlighted, earlier seats folded quietly (no 'Фолд' chips), no villain, no label on later seats", async () => {
    await render(<PokerPositionTable mode="TRAINING_SCENE" scene={sceneOf(20, "RFI_CO")} stackBb={20} />);
    expect(bubbles()).toEqual({});
    expect(foldedSeats()).toEqual(["UTG", "UTG1", "UTG2", "LJ", "HJ"]);
    expect(container.textContent).not.toContain("Фолд");
    expect($('[data-table-seat="CO"] rect')!.getAttribute("fill")).toBe("#d7b55a");
    expect($('[role="img"]')!.getAttribute("aria-label")).toContain("Ты на CO");
    expect(container.textContent).not.toContain("Соперник");
  });

  it("facing-open node: derived 'Рейз' on the opener's seat, villain styled distinctly from hero", async () => {
    await render(<PokerPositionTable mode="TRAINING_SCENE" scene={sceneOf(40, "FACING_OPEN_BB_VS_BTN")} stackBb={40} />);
    expect(bubbles()).toEqual({ BTN: "villain:Рейз" });
    expect(foldedSeats()).toEqual(["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "SB"]);
    const heroFill = $('[data-table-seat="BB"] rect')!.getAttribute("fill");
    const villainFill = $('[data-table-seat="BTN"] rect')!.getAttribute("fill");
    expect(heroFill).toBe("#d7b55a");
    expect(villainFill).not.toBe(heroFill);
    expect(container.textContent).toContain("Соперник");
  });

  it("never renders a size: 20 BB facing-open node (hero has 'Олл-ин 20 BB' button) shows only sizeless labels", async () => {
    await render(<PokerPositionTable mode="TRAINING_SCENE" scene={sceneOf(20, "FACING_OPEN_BB_VS_SB")} stackBb={20} />);
    for (const bubble of $$("[data-seat-action]")) {
      expect(["Рейз", "3-бет", "4-бет", "5-бет", "Олл-ин"]).toContain(bubble.textContent);
      expect(bubble.textContent).not.toMatch(/\d\s*BB|BB/);
    }
    expect($('[data-seat-action="BB"]')).toBeNull();
    expect($('[data-seat-action="SB"]')!.textContent).toBe("Рейз");
  });
});

describe("(14)–(17) manual mode: table-based seat selection", () => {
  async function setup() {
    await render(<PreflopTrainerSetup spots={listAcademyPreflopTrainerSpots()} />);
  }
  const seat = (code: string) => $(`[data-seat="${code}"]`) as HTMLButtonElement;
  const selectedNode = () => $("[data-selected-node]")?.getAttribute("data-selected-node") ?? null;

  it("(14)(15) RFI: tapping a valid seat selects it; an unavailable seat (BB) is disabled and inert", async () => {
    await setup();
    await click($('[data-option="stack-20"]'));
    await click($('[data-option="situation-RFI"]'));
    expect($('[data-testid="seat-prompt"]')!.textContent).toBe("Где ты сидишь?");
    const bb = seat("BB");
    expect(bb.disabled).toBe(true);
    expect(bb.getAttribute("aria-disabled")).toBe("true");
    expect(bb.dataset.seatState).toBe("disabled");
    await click(bb);
    expect(selectedNode()).toBeNull();
    expect(bb.dataset.seatState).toBe("disabled");
    expect($$('[data-seat-state="selectable"]').map((node) => node.dataset.seat)).toEqual(["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB"]);
    await click(seat("CO"));
    expect(seat("CO").dataset.seatState).toBe("hero");
    expect(selectedNode()).toBe("RFI_CO");
  });

  it("(16) BB vs BTN end-to-end through the table: 'Где ты?' → 'Кто сделал действие?'", async () => {
    await setup();
    await click($('[data-option="stack-40"]'));
    await click($('[data-option="situation-FACING_OPEN"]'));
    expect($('[data-testid="seat-prompt"]')!.textContent).toBe("Где ты?");
    // UTG cannot face an open.
    expect(seat("UTG").disabled).toBe(true);
    await click(seat("BB"));
    expect($('[data-testid="seat-prompt"]')!.textContent).toBe("Кто сделал действие?");
    expect(seat("BB").dataset.seatState).toBe("hero");
    expect(seat("BB").disabled).toBe(true);
    await click(seat("BTN"));
    expect(seat("BTN").dataset.seatState).toBe("villain");
    expect(selectedNode()).toBe("FACING_OPEN_BB_VS_BTN");
    expect(Array.from($("[data-selected-node]")!.querySelectorAll("a")).map((link) => link.getAttribute("href"))).toEqual([
      "/academy/solver/preflop/40/facing_open_bb_vs_btn/train",
      "/academy/solver/preflop/40/facing_open_bb_vs_btn",
    ]);
  });

  it("(17) BB vs SB end-to-end through the table", async () => {
    await setup();
    await click($('[data-option="stack-10"]'));
    await click($('[data-option="situation-FACING_OPEN"]'));
    await click(seat("BB"));
    await click(seat("SB"));
    expect(selectedNode()).toBe("FACING_OPEN_BB_VS_SB");
    // Changing the hero resets the villain.
    await click($('[data-testid="change-hero"]'));
    expect($('[data-testid="seat-prompt"]')!.textContent).toBe("Где ты?");
    expect(selectedNode()).toBeNull();
  });
});

describe("(18) spot page range UX", () => {
  it("shows the 13x13 grid, legend, table and start button on first render — no disclosure widget", async () => {
    await render(await SpotPage({ params: Promise.resolve({ stack: "40", node: "facing_open_bb_vs_btn" }) }));
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector("summary")).toBeNull();
    const range = $('[data-testid="range-view"]')!;
    expect(range.querySelectorAll('[role="gridcell"]')).toHaveLength(169);
    expect(range.querySelectorAll("[data-legend-action]")).toHaveLength(3);
    expect($('[data-table-mode="TRAINING_SCENE"]')).not.toBeNull();
    // ADVANCED table: the open is shown by the BTN's trusted 2.3 BB chips, not a duplicate "Рейз" pill.
    expect($('[data-seat-action="BTN"]')).toBeNull();
    expect($('[data-seat-bet="BTN"]')!.textContent).toBe("2.3 BB");
    expect($$("a").map((link) => link.getAttribute("href"))).toContain("/academy/solver/preflop/40/facing_open_bb_vs_btn/train");
  });
});

describe("(19)(20) old lesson table navigation", () => {
  const LESSON_ROUTES: ReadonlyArray<[PreflopPosition, string]> = [
    ["UTG", "/academy/preflop/utg"], ["EP", "/academy/preflop/ep"], ["MP1", "/academy/preflop/mp1"],
    ["MP2", "/academy/preflop/mp2"], ["HJ", "/academy/preflop/hj"], ["CO", "/academy/preflop/co"], ["BTN", "/academy/preflop/btn"],
  ];

  it("(19) the 7 lesson seats are links to their lessons — click, Enter and Space all navigate", async () => {
    await render(await AcademyLessonPage({ params: Promise.resolve({ position: "utg" }) }));
    const links = $$("[data-lesson-seat]");
    expect(links.map((link) => [link.dataset.lessonSeat, link.getAttribute("href")])).toEqual(LESSON_ROUTES);
    for (const link of links) {
      expect(link.tagName).toBe("A");
      expect(link.getAttribute("aria-label")).toMatch(/^Перейти к уроку |— текущий урок$/);
    }
    const current = $('[data-lesson-seat="UTG"]')!;
    expect(current.getAttribute("aria-current")).toBe("page");
    const co = $('[data-lesson-seat="CO"]')!;
    expect(co.getAttribute("aria-label")).toBe("Перейти к уроку CO");

    await click(co);
    expect(mocks.linkClick).toHaveBeenLastCalledWith("/academy/preflop/co");
    await key(co, "Enter");
    expect(mocks.push).toHaveBeenLastCalledWith("/academy/preflop/co");
    await key($('[data-lesson-seat="EP"]')!, " ");
    expect(mocks.push).toHaveBeenLastCalledWith("/academy/preflop/ep");
    expect(mocks.push).toHaveBeenCalledTimes(2);
  });

  it("(20) SB / BB stay visible but have no link, button or tab stop (no fabricated lesson)", async () => {
    await render(await AcademyLessonPage({ params: Promise.resolve({ position: "btn" }) }));
    expect($('[data-table-seat="SB"]')).not.toBeNull();
    expect($('[data-table-seat="BB"]')).not.toBeNull();
    const hrefs = $$("a").map((link) => link.getAttribute("href"));
    expect(hrefs).not.toContain("/academy/preflop/sb");
    expect(hrefs).not.toContain("/academy/preflop/bb");
    expect($$("[data-lesson-seat]").map((link) => link.dataset.lessonSeat)).not.toEqual(expect.arrayContaining(["SB", "BB"]));
    const overlay = $('[data-table-mode="LESSON_NAVIGATION"] > div')!;
    expect(overlay.querySelectorAll("a, button, [tabindex]")).toHaveLength(7);
  });
});

describe("STATIC default mode renders exactly as before", () => {
  // Verbatim copy of the pre-change component (0bf5ded) for a byte-level comparison.
  function OriginalPokerPositionTable({ activePosition }: { activePosition: PreflopPosition }) {
    const activeSeat = getAcademyTableSeat(activePosition);
    return (
      <figure className="m-0 min-w-0 overflow-hidden rounded-[24px] border border-white/[0.08] bg-white/[0.035] px-3 py-4">
        <figcaption className="flex items-center justify-between gap-3 px-1">
          <span className="text-sm font-medium text-white/65">
            Позиция за столом
          </span>
          <span className="text-xs font-semibold text-[#e0c477]">
            {activeSeat.label}
          </span>
        </figcaption>
        <svg role="img" aria-label={`Стол 9-max, выделена позиция ${activeSeat.label}`} viewBox="0 0 360 230" className="mt-2 block h-auto w-full max-w-full">
          <defs>
            <linearGradient id="academy-table-felt" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#234d38" />
              <stop offset="1" stopColor="#11291e" />
            </linearGradient>
          </defs>
          <ellipse cx="180" cy="115" rx="111" ry="70" fill="#080b09" stroke="#26372e" strokeWidth="10" />
          <ellipse cx="180" cy="115" rx="103" ry="62" fill="url(#academy-table-felt)" stroke="#496d59" strokeWidth="1.5" />
          <ellipse cx="180" cy="115" rx="79" ry="42" fill="none" stroke="rgba(255,255,255,0.08)" />
          <text x="180" y="111" textAnchor="middle" fill="rgba(255,255,255,0.28)" fontSize="10" fontWeight="700" letterSpacing="2.2">
            RERAISE
          </text>
          <text x="180" y="128" textAnchor="middle" fill="rgba(255,255,255,0.18)" fontSize="9">
            9-MAX
          </text>
          {ACADEMY_TABLE_SEATS.map((seat) => {
            const active = seat.lessonPosition === activePosition;
            return (
              <g key={seat.label} transform={`translate(${seat.x} ${seat.y})`} aria-label={`${seat.label}${active ? ", текущая позиция" : ""}`}>
                <rect width="62" height="30" rx="12" fill={active ? "#d7b55a" : "#111713"} stroke={active ? "#f0d98a" : "rgba(255,255,255,0.14)"} strokeWidth={active ? "2" : "1"} />
                <text x="31" y="19" textAnchor="middle" fill={active ? "#11120f" : "rgba(255,255,255,0.66)"} fontSize="10.5" fontWeight={active ? "800" : "600"}>
                  {seat.label}
                </text>
              </g>
            );
          })}
        </svg>
      </figure>
    );
  }

  it.each<PreflopPosition>(["UTG", "EP", "MP1", "MP2", "HJ", "CO", "BTN"])("prop-less usage for %s is byte-identical", (position) => {
    expect(renderToStaticMarkup(<PokerPositionTable activePosition={position} />))
      .toBe(renderToStaticMarkup(<OriginalPokerPositionTable activePosition={position} />));
  });
});
