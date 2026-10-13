/**
 * Academy access — pages and UX. Locked pages are gated on the SERVER
 * (`AcademyPageAccessGate` → the same `assertAcademyAccess` the APIs use):
 * for BEGINNER_ONLY the server returns the branded locked screen INSTEAD of
 * the page (its content is never part of the response); the beginner
 * curriculum stays fully open; FULL is unchanged. Home / "Что дальше" /
 * trainer links follow the server-resolved tier from the auth gate's context.
 */
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  player: { id: "11111111-1111-4111-8111-111111111111", role: "player" } as { id: string; role: string } | null,
  participated: false,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/academy",
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest} onClick={(event) => event.preventDefault()}>{children}</a>
  ),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "signed-session" }) }) }));
vi.mock("@/components/academy/use-academy-progress", () => ({
  useAcademyProgress: () => ({ data: null, error: null, retry: () => {} }),
}));
vi.mock("@/features/auth-server", () => ({ getPlayerFromSessionServer: async () => state.player }));
vi.mock("@/lib/repositories/season", () => ({
  seasonRepository: { findActive: async () => ({ id: "season-current", title: "Осень 2026", is_active: true }) },
}));
vi.mock("@/lib/repositories/academy-access", () => ({
  academyAccessRepository: { hasPlayerParticipatedInSeason: async () => state.participated },
}));

const { AcademyPageAccessGate } = await import("@/components/academy/academy-page-access-gate");
const { AcademyAccessProvider } = await import("@/components/academy/academy-access-context");
const { AcademyLockedScreen, AcademyAccessPending } = await import("@/components/academy/academy-locked-screen");
const { default: HomePage } = await import("@/app/academy/page");
const { default: BeginnerPage } = await import("@/app/academy/beginner/page");
const { default: AfterOpenLessonPage } = await import("@/app/academy/beginner/after-open/[lesson]/page");
const { default: BaseLessonPage } = await import("@/app/academy/preflop/[position]/page");
const { default: IntermediatePage } = await import("@/app/academy/intermediate/page");
const { default: AdvancedPage } = await import("@/app/academy/advanced/page");
const { default: TrainersPage } = await import("@/app/academy/trainers/page");
const { default: SetupPage } = await import("@/app/academy/solver/preflop/page");
const { default: QuickMixPage } = await import("@/app/academy/solver/preflop/mix/page");
const { default: SpotPage } = await import("@/app/academy/solver/preflop/[stack]/[node]/page");
const { default: SpotTrainPage } = await import("@/app/academy/solver/preflop/[stack]/[node]/train/page");
const { default: PushFoldHomePage } = await import("@/app/academy/solver/push-fold/page");
const { default: PushFoldMixPage } = await import("@/app/academy/solver/push-fold/mix/page");
const { default: PushFoldSpotPage } = await import("@/app/academy/solver/push-fold/[stack]/[node]/page");
const { default: PushFoldTrainPage } = await import("@/app/academy/solver/push-fold/[stack]/[node]/train/page");
const { default: RfiModulePage } = await import("@/app/academy/solver/rfi/100bb/page");
const { default: RfiLessonPage } = await import("@/app/academy/solver/rfi/100bb/[position]/page");
const { default: RfiTrainPage } = await import("@/app/academy/solver/rfi/100bb/[position]/train/page");
const { ACADEMY_BEGINNER_SPOTS } = await import("@/config/academy/access-policy");
const { ACADEMY_BEGINNER_AFTER_OPEN_LESSONS } = await import("@/config/academy/beginner-after-open");
const { buildAcademyPreflopTrainerSession, requireAcademyPreflopTrainerSpotByStack, toPreflopTrainerReveal, toPublicPreflopTrainerQuestion } = await import("@/lib/academy/preflop-trainer");
const { PreflopTrainer } = await import("@/components/academy/preflop-trainer");

type Tier = "BEGINNER_ONLY" | "FULL";
const view = (access: Tier) => ({ access, season: { id: "season-current", title: "Осень 2026" } });

let container: HTMLDivElement;
let root: Root;
const $ = (selector: string) => container.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => Array.from(container.querySelectorAll<HTMLElement>(selector));
const hrefs = () => $$("a[href]").map((anchor) => anchor.getAttribute("href"));

async function render(element: ReactElement, tier: Tier | null = null) {
  await act(async () => {
    root.render(tier ? <AcademyAccessProvider value={view(tier)}>{element}</AcademyAccessProvider> : element);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/** Runs a page like the server would: the page, then its (async server) access gate. */
async function serverRender(page: ReactElement | Promise<ReactElement>): Promise<ReactElement> {
  const element = await page;
  expect(element.type).toBe(AcademyPageAccessGate);
  return await AcademyPageAccessGate(element.props as Parameters<typeof AcademyPageAccessGate>[0]) as ReactElement;
}

const params = <T,>(value: T) => ({ params: Promise.resolve(value) });
const spotParams = (stackBb: number, nodeKey: string) => params({ stack: String(stackBb), node: nodeKey.toLowerCase() });

const LOCKED_PAGES: ReadonlyArray<readonly [string, () => ReactElement | Promise<ReactElement>]> = [
  ["/academy/intermediate", () => IntermediatePage()],
  ["/academy/advanced", () => AdvancedPage()],
  ["/academy/trainers", () => TrainersPage()],
  ["/academy/solver/preflop (manual setup)", () => SetupPage()],
  ["/academy/solver/preflop/mix (Quick Mix)", () => QuickMixPage()],
  ["non-beginner spot 40/rfi_co", () => SpotPage(spotParams(40, "RFI_CO"))],
  ["non-beginner spot 40/rfi_co/train", () => SpotTrainPage({ ...spotParams(40, "RFI_CO"), searchParams: Promise.resolve({ from: "beginner", preset: "open-raise" }) })],
  ["non-beginner spot 20/facing_open_bb_vs_btn", () => SpotPage(spotParams(20, "FACING_OPEN_BB_VS_BTN"))],
  ["advanced spot 100/facing_4bet_btn_vs_co/train", () => SpotTrainPage({ ...spotParams(100, "FACING_4BET_BTN_VS_CO"), searchParams: Promise.resolve({ from: "advanced" }) })],
  ["Push/Fold home", () => PushFoldHomePage()],
  ["Push/Fold quick", () => PushFoldMixPage()],
  ["Push/Fold spot", () => PushFoldSpotPage(params({ stack: "10", node: "first_in_shove_btn" }))],
  ["Push/Fold train", () => PushFoldTrainPage(params({ stack: "10", node: "first_in_shove_btn" }))],
  ["Solver RFI module", () => RfiModulePage()],
  ["Solver RFI lesson", () => RfiLessonPage(params({ position: "utg" }))],
  ["Solver RFI train", () => RfiTrainPage(params({ position: "utg" }))],
];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv("SESSION_SECRET", "academy-access-pages-secret");
  vi.stubGlobal("scrollTo", vi.fn());
  Element.prototype.scrollIntoView = vi.fn() as unknown as Element["scrollIntoView"];
  // Trainer screens fetch their first question on mount; keep it pending.
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  state.player = { id: "11111111-1111-4111-8111-111111111111", role: "player" };
  state.participated = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("locked routes (BEGINNER_ONLY, direct navigation): server returns the branded locked screen instead of the page", () => {
  it.each(LOCKED_PAGES)("%s", async (_route, page) => {
    const out = await serverRender(page());
    // The server response IS the locked screen — the page's element tree is not part of it.
    expect(out.type).toBe(AcademyLockedScreen);
    expect(out.props).toEqual({});

    await render(out, "BEGINNER_ONLY");
    expect($("[data-academy-locked]")).not.toBeNull();
    expect($("h1")!.textContent).toBe("Доступно участникам сезона");
    expect(container.textContent).toContain("Более глубокие материалы и тренажёры открываются после вашей первой игры в текущем сезоне.");
    expect($("[data-academy-locked-cta]")!.getAttribute("href")).toBe("/tournaments");
    expect($("[data-academy-locked-cta]")!.textContent).toBe("Выбрать турнир");
    expect($("[data-academy-locked-back]")!.getAttribute("href")).toBe("/academy/beginner");
    expect($("[data-academy-locked-back]")!.textContent).toBe("Вернуться к урокам для новичков");
    // Nothing of the locked content: no grid, no trainer, no links into locked areas, no 403 page.
    expect($$("[data-hand], [role='gridcell'], button[data-action-code], [data-trainer-entry]")).toHaveLength(0);
    expect(hrefs()).toEqual(["/tournaments", "/academy/beginner"]);
    expect(container.textContent).not.toMatch(/403|Forbidden|Доступ запрещён/);
  });
});

describe("FULL: every locked route renders its page exactly as before", () => {
  it.each(LOCKED_PAGES)("%s (participant)", async (_route, page) => {
    state.participated = true;
    const out = await serverRender(page());
    expect(out.type).not.toBe(AcademyLockedScreen);
    await render(out, "FULL");
    expect($("[data-academy-locked]")).toBeNull();
  });

  it.each([["admin"], ["operator"]])("%s with zero participation", async (role) => {
    state.player = { id: state.player!.id, role };
    for (const [, page] of LOCKED_PAGES) {
      expect((await serverRender(page())).type).not.toBe(AcademyLockedScreen);
    }
  });
});

describe("no session yet (Telegram cookie still being restored): neutral placeholder, never content", () => {
  it("renders 'Проверяем доступ...' only", async () => {
    state.player = null;
    const out = await serverRender(IntermediatePage());
    expect(out.type).toBe(AcademyAccessPending);
    await render(out);
    expect(container.textContent).toBe("Проверяем доступ...");
  });
});

describe("BEGINNER_ONLY keeps the complete beginner experience", () => {
  it.each(ACADEMY_BEGINNER_SPOTS.map((spot) => [`${spot.stackBb}/${spot.nodeKey}`, spot] as const))("exact beginner spot %s: study page (real range) and trainer open", async (_label, spot) => {
    const study = await serverRender(SpotPage(spotParams(spot.stackBb, spot.nodeKey)));
    expect(study.type).not.toBe(AcademyLockedScreen);
    await render(study, "BEGINNER_ONLY");
    expect($$('[role="gridcell"]')).toHaveLength(169);
    // Back link leads to "Новичкам", never into the locked trainer hub.
    expect(hrefs()).toContain("/academy/beginner#step-2");
    expect(hrefs()).not.toContain("/academy/solver/preflop");

    const train = await serverRender(SpotTrainPage({ ...spotParams(spot.stackBb, spot.nodeKey), searchParams: Promise.resolve({}) }));
    expect(train.type).not.toBe(AcademyLockedScreen);
  });

  it("beginner landing, Шаг 1 lessons and Шаг 2 lessons are not gated at all", async () => {
    for (const page of [HomePage(), BeginnerPage(), await BaseLessonPage(params({ position: "utg" })), ...await Promise.all(ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.map((lesson) => AfterOpenLessonPage(params({ lesson: lesson.slug }))))]) {
      expect(page.type).not.toBe(AcademyPageAccessGate);
    }
  });

  it("every Шаг 2 lesson's links (practice / study / compare) point to spots the server allows", async () => {
    for (const lesson of ACADEMY_BEGINNER_AFTER_OPEN_LESSONS) {
      await render(await AfterOpenLessonPage(params({ lesson: lesson.slug })), "BEGINNER_ONLY");
      const spotLinks = hrefs().filter((href) => href!.startsWith("/academy/solver/preflop/"));
      expect(spotLinks.length).toBeGreaterThanOrEqual(2);
      for (const href of spotLinks) {
        const [, , , , stack, node] = href!.split("?")[0].split("/");
        const out = await serverRender(href!.includes("/train")
          ? SpotTrainPage({ ...spotParams(Number(stack), node), searchParams: Promise.resolve({}) })
          : SpotPage(spotParams(Number(stack), node)));
        expect(out.type).not.toBe(AcademyLockedScreen);
      }
    }
  });
});

describe("Academy home", () => {
  it("BEGINNER_ONLY: Новичкам unlocked; Продолжающим / Продвинутым / Тренажёры visible but locked; membership CTA → /tournaments", async () => {
    await render(HomePage(), "BEGINNER_ONLY");
    const beginner = $('[data-destination="beginner"]')!;
    expect(beginner.getAttribute("href")).toBe("/academy/beginner");
    expect(beginner.hasAttribute("data-destination-locked")).toBe(false);
    for (const code of ["intermediate", "advanced", "trainers"]) {
      const card = $(`[data-destination="${code}"]`)!;
      expect(card).not.toBeNull(); // never hidden
      expect(card.hasAttribute("data-destination-locked")).toBe(true);
      expect(card.getAttribute("href")).toBe("#academy-membership");
      expect(card.querySelector("[data-destination-lock-reason]")!.textContent).toBe("Откроется после первой игры в сезоне");
      expect(card.querySelector("svg")).not.toBeNull();
      expect(card.querySelector("[data-destination-progress]")).toBeNull(); // no progress promise
    }
    expect(hrefs()).not.toContain("/academy/intermediate");
    expect(hrefs()).not.toContain("/academy/advanced");
    expect(hrefs()).not.toContain("/academy/trainers");

    const panel = $("[data-academy-membership]")!;
    expect(panel.querySelector("h2")!.textContent).toBe("Продолжение — для участников сезона");
    expect(Array.from(panel.querySelectorAll("p")).map((p) => p.textContent)).toEqual([
      "Более глубокие материалы и тренажёры доступны игрокам, которые уже были у нас на игре в этом сезоне.",
      "Запишитесь на свою первую игру — после участия доступ откроется автоматически.",
    ]);
    const cta = $("[data-academy-membership-cta]")!;
    expect(cta.textContent).toBe("Выбрать турнир");
    expect(cta.getAttribute("href")).toBe("/tournaments");
    expect(container.textContent).not.toMatch(/оплат|купить|подписк|premium/i);
  });

  it("FULL: all cards are the existing links, no lock, no membership CTA", async () => {
    await render(HomePage(), "FULL");
    expect($$("[data-destination-locked]")).toHaveLength(0);
    expect($("[data-academy-membership]")).toBeNull();
    for (const [code, href] of [["beginner", "/academy/beginner"], ["intermediate", "/academy/intermediate"], ["advanced", "/academy/advanced"], ["trainers", "/academy/trainers"]]) {
      expect($(`[data-destination="${code}"]`)!.getAttribute("href")).toBe(href);
    }
  });
});

describe("Новичкам · Что дальше", () => {
  it("BEGINNER_ONLY: the participation CTA instead of links into locked content", async () => {
    await render(BeginnerPage(), "BEGINNER_ONLY");
    expect($('[data-next-step="trainers"]')).toBeNull();
    expect($('[data-next-step="intermediate"]')).toBeNull();
    expect($('section[aria-label="Что дальше"] [data-academy-membership-cta]')!.getAttribute("href")).toBe("/tournaments");
    // Шаг 1 and Шаг 2 stay complete.
    expect($('[data-beginner-step="1"]')).not.toBeNull();
    expect($('[data-beginner-step="2"]')).not.toBeNull();
  });

  it("FULL: the existing onward links, unchanged", async () => {
    await render(BeginnerPage(), "FULL");
    expect($('[data-next-step="trainers"]')!.getAttribute("href")).toBe("/academy/trainers");
    expect($('[data-next-step="intermediate"]')!.getAttribute("href")).toBe("/academy/intermediate");
    expect($("[data-academy-membership]")).toBeNull();
  });
});

describe("range-after-answer (4d8db4d) works for BEGINNER_ONLY on an allowed Шаг 2 training", () => {
  it("before answering: no range; after answering: the node's real 169-cell range; links stay inside the beginner curriculum", async () => {
    const ref = ACADEMY_BEGINNER_SPOTS[0];
    const { spot } = requireAcademyPreflopTrainerSpotByStack(ref.stackBb, ref.nodeKey);
    const session = buildAcademyPreflopTrainerSession({ playerId: state.player!.id, attemptId: "22222222-2222-4222-8222-222222222222", datasetId: spot.datasetId, nodeKey: spot.nodeKey });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { questionIndex: number; selectedAction: string };
      const question = session[body.questionIndex];
      const payload = url.endsWith("/session") ? toPublicPreflopTrainerQuestion(question) : toPreflopTrainerReveal(question, body.selectedAction);
      return { ok: true, json: async () => JSON.parse(JSON.stringify(payload)) } as Response;
    }));

    await render(<PreflopTrainer selection={{ datasetId: spot.datasetId, nodeKey: spot.nodeKey, stackBb: spot.stackBb }} />, "BEGINNER_ONLY");
    expect($("button[data-action-code]")).not.toBeNull();
    expect($('[data-testid="answer-range"]')).toBeNull();
    expect($("[data-hand]")).toBeNull();
    expect(hrefs()).toContain("/academy/beginner#step-2");
    expect(hrefs()).not.toContain("/academy/solver/preflop#setup");

    await act(async () => $("button[data-action-code]")!.click());
    await act(async () => { await Promise.resolve(); });
    expect($$('[data-testid="answer-range"] [data-hand]')).toHaveLength(169);
  });
});
