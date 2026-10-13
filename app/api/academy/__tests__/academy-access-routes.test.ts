/**
 * Academy access — ADVERSARIAL API tests. A BEGINNER_ONLY (authenticated,
 * not entitled) player calls the real route handlers directly: every locked
 * session / reveal / attempt is refused with 403 BEFORE any question, range
 * or reveal payload exists, while the exact beginner spots keep working
 * end-to-end (session → reveal with the 4d8db4d range → attempt). Tier
 * resolution runs for real (features/academy-access.ts); only the season /
 * participation repositories and the session are stubbed.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { primaryStrategyActions } from "@/lib/academy/strategy-answer";

const SECRET = "academy-access-route-secret-never-in-output";
const state = vi.hoisted(() => ({
  player: { id: "11111111-1111-4111-8111-111111111111", role: "player" } as { id: string; role: string } | null,
  participated: false,
  activeSeason: { id: "season-current", title: "Осень 2026", is_active: true } as { id: string; title: string; is_active: boolean } | null,
  recorded: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/features/auth-server", () => ({ getPlayerFromSessionServer: async () => state.player }));
vi.mock("@/lib/repositories/season", () => ({ seasonRepository: { findActive: async () => state.activeSeason } }));
vi.mock("@/lib/repositories/academy-access", () => ({
  academyAccessRepository: { hasPlayerParticipatedInSeason: async () => state.participated },
}));
vi.mock("@/lib/repositories/academy-progress", () => ({
  academyProgressRepository: {
    recordCompletedAttempt: async (input: Record<string, unknown>) => {
      state.recorded.push(input);
      return {
        lesson_code: input.lessonCode, attempts_count: 1, last_score_percent: input.scorePercent,
        best_score_percent: input.scorePercent, passed: input.passed, first_completed_at: null,
        last_attempt_at: "2026-10-13T00:00:00.000Z", is_new_attempt: true, first_pass: false, new_best: false,
      };
    },
  },
}));

const { GET: accessGet } = await import("@/app/api/academy/access/route");
const { POST: attemptsPost } = await import("@/app/api/academy/attempts/route");
const { POST: preflopSession } = await import("@/app/api/academy/solver/preflop/session/route");
const { POST: preflopReveal } = await import("@/app/api/academy/solver/preflop/reveal/route");
const { POST: mixSession } = await import("@/app/api/academy/solver/preflop/mix/session/route");
const { POST: mixReveal } = await import("@/app/api/academy/solver/preflop/mix/reveal/route");
const { POST: pushFoldSession } = await import("@/app/api/academy/solver/push-fold/session/route");
const { POST: pushFoldReveal } = await import("@/app/api/academy/solver/push-fold/reveal/route");
const { POST: pushFoldMixSession } = await import("@/app/api/academy/solver/push-fold/mix/session/route");
const { POST: pushFoldMixReveal } = await import("@/app/api/academy/solver/push-fold/mix/reveal/route");
const { POST: solverSession } = await import("@/app/api/academy/solver/session/route");
const { POST: solverReveal } = await import("@/app/api/academy/solver/reveal/route");
const { ACADEMY_BEGINNER_SPOTS, ACADEMY_BEGINNER_LESSON_CODES } = await import("@/config/academy/access-policy");
const { ACADEMY_ACCESS_DENIED_CODE } = await import("@/config/academy/access-copy");
const { getAcademyModule } = await import("@/config/academy/catalog");
const { ACADEMY_SOLVER_RFI_MODULE_CODE } = await import("@/config/academy/catalog-codes");
const { ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, ACADEMY_PREFLOP_QUICK_MIX_MODE } = await import("@/config/academy/preflop-trainer");
const { ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE } = await import("@/config/academy/push-fold-trainer");
const { buildAcademyPreflopTrainerSession, requireAcademyPreflopTrainerSpotByStack } = await import("@/lib/academy/preflop-trainer");
const { buildAcademyPreflopMixSession } = await import("@/lib/academy/preflop-mix");
const { CANONICAL_STARTING_HANDS } = await import("@/lib/academy/preflop");

const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const DENIED_MESSAGE = "Расширенная Академия доступна после первой игры в текущем сезоне";
const LEAKS = ["frequencies", "frequency", "rangeHands", "resolvedAction", "correctAction", "randomizer", "hand", "renderedCards", "actions", "spot", SECRET];

const beginnerSpot = requireAcademyPreflopTrainerSpotByStack(ACADEMY_BEGINNER_SPOTS[0].stackBb, ACADEMY_BEGINNER_SPOTS[0].nodeKey).spot;
/** Real registered nodes the beginner curriculum does NOT use. */
const LOCKED_SPOTS = [
  requireAcademyPreflopTrainerSpotByStack(40, "RFI_CO").spot,
  requireAcademyPreflopTrainerSpotByStack(20, "FACING_OPEN_BB_VS_BTN").spot,
  requireAcademyPreflopTrainerSpotByStack(100, "FACING_4BET_BTN_VS_CO").spot,
];
const RFI_LESSON = getAcademyModule(ACADEMY_SOLVER_RFI_MODULE_CODE)!.lessons[0].code;

function post(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie: "reraise_session=signed" },
  });
}

/** 403 with ONLY the stable access error — no question / range / reveal fields at all. */
async function expectDenied(response: Response) {
  expect(response.status).toBe(403);
  const body = await response.json() as Record<string, unknown>;
  expect(body).toEqual({ error: DENIED_MESSAGE, code: ACADEMY_ACCESS_DENIED_CODE });
  const raw = JSON.stringify(body);
  for (const leak of LEAKS) expect(raw).not.toContain(`"${leak}"`);
}

function fixedAnswers(spot: { datasetId: string; nodeKey: string }, extra: Record<string, unknown> = {}) {
  const session = buildAcademyPreflopTrainerSession({ playerId: state.player!.id, attemptId: ATTEMPT_ID, datasetId: spot.datasetId, nodeKey: spot.nodeKey });
  return session.map((question, questionIndex) => ({
    questionIndex, selectedAction: primaryStrategyActions(question.frequencies)[0], datasetId: spot.datasetId, nodeKey: spot.nodeKey, ...extra,
  }));
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  state.player = { id: "11111111-1111-4111-8111-111111111111", role: "player" };
  state.participated = false;
  state.activeSeason = { id: "season-current", title: "Осень 2026", is_active: true };
  state.recorded = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("BEGINNER_ONLY cannot bypass the lock through the API (403, nothing built, nothing recorded)", () => {
  it("Quick Mix session and reveal → 403 (checked before the body is even validated)", async () => {
    await expectDenied(await mixSession(post("/api/academy/solver/preflop/mix/session", { attemptId: ATTEMPT_ID, questionIndex: 0 })));
    await expectDenied(await mixReveal(post("/api/academy/solver/preflop/mix/reveal", { attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "FOLD" })));
    // Malformed body would be a 400 for an entitled player; the restricted player learns nothing.
    await expectDenied(await mixSession(post("/api/academy/solver/preflop/mix/session", { attemptId: "x", questionIndex: 99 })));
  });

  it("a locked fixed-node session and reveal → 403 (any stack, including the beginner 40 BB stack)", async () => {
    for (const spot of LOCKED_SPOTS) {
      await expectDenied(await preflopSession(post("/api/academy/solver/preflop/session", { datasetId: spot.datasetId, nodeKey: spot.nodeKey, attemptId: ATTEMPT_ID, questionIndex: 0 })));
      await expectDenied(await preflopReveal(post("/api/academy/solver/preflop/reveal", { datasetId: spot.datasetId, nodeKey: spot.nodeKey, attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "FOLD" })));
    }
  });

  it("client context markers never authorize (from=beginner / preset / lesson in the body are ignored)", async () => {
    const spot = LOCKED_SPOTS[0];
    const forged = { datasetId: spot.datasetId, nodeKey: spot.nodeKey, attemptId: ATTEMPT_ID, questionIndex: 0, from: "beginner", preset: "bb-defence", lessonSlug: "bb-defence", access: "FULL" };
    await expectDenied(await preflopSession(post("/api/academy/solver/preflop/session?from=beginner&preset=bb-defence", forged)));
    await expectDenied(await preflopReveal(post("/api/academy/solver/preflop/reveal?from=beginner", { ...forged, selectedAction: "FOLD" })));
  });

  it("an unknown / forged node → 403 for the restricted player (fail closed before validation)", async () => {
    await expectDenied(await preflopSession(post("/api/academy/solver/preflop/session", { datasetId: "external_mtt_preflop_9max_40bb_v1", nodeKey: "NOPE", attemptId: ATTEMPT_ID, questionIndex: 0 })));
  });

  it("Push/Fold fixed + quick session / reveal → 403 (not the 409 'paused' answer)", async () => {
    const body = { datasetId: "x", nodeKey: "y", attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "FOLD" };
    await expectDenied(await pushFoldSession(post("/api/academy/solver/push-fold/session", body)));
    await expectDenied(await pushFoldReveal(post("/api/academy/solver/push-fold/reveal", body)));
    await expectDenied(await pushFoldMixSession(post("/api/academy/solver/push-fold/mix/session", body)));
    await expectDenied(await pushFoldMixReveal(post("/api/academy/solver/push-fold/mix/reveal", body)));
  });

  it("intermediate Solver Lab (100 BB RFI) session / reveal → 403", async () => {
    await expectDenied(await solverSession(post("/api/academy/solver/session", { lessonCode: RFI_LESSON, attemptId: ATTEMPT_ID, questionIndex: 0 })));
    await expectDenied(await solverReveal(post("/api/academy/solver/reveal", { lessonCode: RFI_LESSON, attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "FOLD" })));
  });

  it("locked attempt submissions → 403 and NOTHING is recorded", async () => {
    const lockedSpot = LOCKED_SPOTS[0];
    const mix = buildAcademyPreflopMixSession({ playerId: state.player!.id, attemptId: ATTEMPT_ID });
    const attempts = [
      // locked fixed node
      { lessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, questions: fixedAnswers(lockedSpot) },
      // locked fixed node + client "from=beginner" marker on every answer
      { lessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, from: "beginner", questions: fixedAnswers(lockedSpot, { from: "beginner" }) },
      // Quick Mix attempt (same lesson code)
      { lessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, questions: mix.map((question, questionIndex) => ({ questionIndex, selectedAction: question.actions[0].code, datasetId: question.spot.datasetId, nodeKey: question.spot.nodeKey, mode: ACADEMY_PREFLOP_QUICK_MIX_MODE })) },
      // first answer a beginner node, a later answer a locked node
      { lessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, questions: [...fixedAnswers(beginnerSpot).slice(0, 9), fixedAnswers(lockedSpot)[9]] },
      // Push/Fold and Solver Lab RFI lessons
      { lessonCode: ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE, questions: [] },
      { lessonCode: RFI_LESSON, questions: [] },
      // unknown lesson code
      { lessonCode: "made_up_lesson", questions: [] },
    ];
    for (const attempt of attempts) {
      await expectDenied(await attemptsPost(post("/api/academy/attempts", { attemptId: ATTEMPT_ID, ...attempt })));
    }
    expect(state.recorded).toEqual([]);
  });

  it("no active season: an ordinary player with participation stays restricted", async () => {
    state.activeSeason = null;
    state.participated = true;
    await expectDenied(await mixSession(post("/api/academy/solver/preflop/mix/session", { attemptId: ATTEMPT_ID, questionIndex: 0 })));
  });

  it("401 is reserved for the unauthenticated; the restricted player gets 403", async () => {
    state.player = null;
    expect((await mixSession(post("/api/academy/solver/preflop/mix/session", { attemptId: ATTEMPT_ID, questionIndex: 0 }))).status).toBe(401);
    expect((await accessGet(new NextRequest("http://localhost/api/academy/access"))).status).toBe(401);
  });
});

describe("BEGINNER_ONLY keeps the complete beginner training (session → reveal with range → attempt)", () => {
  it.each(ACADEMY_BEGINNER_SPOTS.map((spot) => [`${spot.stackBb} BB ${spot.nodeKey}`, spot] as const))("%s", async (_label, ref) => {
    const spot = requireAcademyPreflopTrainerSpotByStack(ref.stackBb, ref.nodeKey).spot;
    const expected = buildAcademyPreflopTrainerSession({ playerId: state.player!.id, attemptId: ATTEMPT_ID, datasetId: spot.datasetId, nodeKey: spot.nodeKey });

    // Before answering: answer-free question (4d8db4d leak protection intact).
    const session = await preflopSession(post("/api/academy/solver/preflop/session", { datasetId: spot.datasetId, nodeKey: spot.nodeKey, attemptId: ATTEMPT_ID, questionIndex: 3 }));
    expect(session.status).toBe(200);
    const question = await session.json() as Record<string, unknown>;
    expect(Object.keys(question).sort()).toEqual(["actions", "hand", "renderedCards", "spot"]);
    for (const leak of ["frequencies", "rangeHands", "resolvedAction", "randomizer", SECRET]) expect(JSON.stringify(question)).not.toContain(leak);

    // After answering: the reveal carries THIS node's exact range.
    const reveal = await preflopReveal(post("/api/academy/solver/preflop/reveal", { datasetId: spot.datasetId, nodeKey: spot.nodeKey, attemptId: ATTEMPT_ID, questionIndex: 3, selectedAction: expected[3].actions[0].code }));
    expect(reveal.status).toBe(200);
    const revealed = await reveal.json() as { rangeHands: Record<string, unknown>; spot: { nodeKey: string; stackBb: number } };
    expect(Object.keys(revealed.rangeHands).sort()).toEqual([...CANONICAL_STARTING_HANDS].sort());
    expect(revealed.rangeHands).toEqual(JSON.parse(JSON.stringify(expected[3].rangeHands)));
    expect(revealed.spot).toMatchObject({ nodeKey: spot.nodeKey, stackBb: spot.stackBb });

    // Attempt: verified, recorded under the trainer code + the spot's progress code, same scoring.
    const attempt = await attemptsPost(post("/api/academy/attempts", { attemptId: ATTEMPT_ID, lessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, questions: fixedAnswers(spot) }));
    expect(attempt.status).toBe(200);
    expect((await attempt.json() as { result: { percentage: number } }).result.percentage).toBe(100);
    expect(state.recorded.map((row) => row.lessonCode)).toContain(ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE);
  });

  it("Шаг 1 (База MTT) lesson attempts stay open", async () => {
    const hands = CANONICAL_STARTING_HANDS.slice(0, 10);
    for (const lessonCode of ACADEMY_BEGINNER_LESSON_CODES) {
      const response = await attemptsPost(post("/api/academy/attempts", {
        attemptId: ATTEMPT_ID, lessonCode, questions: hands.map((hand) => ({ hand, selectedAction: "FOLD" })),
      }));
      expect(response.status).toBe(200);
    }
  });

  it("GET /api/academy/access returns only { access, season }", async () => {
    const response = await accessGet(new NextRequest("http://localhost/api/academy/access"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ access: "BEGINNER_ONLY", season: { id: "season-current", title: "Осень 2026" } });
  });
});

describe("FULL: the same calls behave exactly as before", () => {
  it.each([
    ["participant", () => { state.participated = true; }],
    ["admin (no participation)", () => { state.player = { id: state.player!.id, role: "admin" }; }],
    ["operator (no participation)", () => { state.player = { id: state.player!.id, role: "operator" }; }],
  ] as const)("%s", async (_label, setUp) => {
    setUp();
    expect((await mixSession(post("/api/academy/solver/preflop/mix/session", { attemptId: ATTEMPT_ID, questionIndex: 0 }))).status).toBe(200);
    expect((await mixReveal(post("/api/academy/solver/preflop/mix/reveal", { attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: buildAcademyPreflopMixSession({ playerId: state.player!.id, attemptId: ATTEMPT_ID })[0].actions[0].code }))).status).toBe(200);
    const locked = LOCKED_SPOTS[0];
    expect((await preflopSession(post("/api/academy/solver/preflop/session", { datasetId: locked.datasetId, nodeKey: locked.nodeKey, attemptId: ATTEMPT_ID, questionIndex: 0 }))).status).toBe(200);
    expect((await attemptsPost(post("/api/academy/attempts", { attemptId: ATTEMPT_ID, lessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, questions: fixedAnswers(locked) }))).status).toBe(200);
    expect((await solverSession(post("/api/academy/solver/session", { lessonCode: RFI_LESSON, attemptId: ATTEMPT_ID, questionIndex: 0 }))).status).toBe(200);
    // Push/Fold keeps its existing behaviour for FULL (scored training paused → 409, never 403).
    expect((await pushFoldMixSession(post("/api/academy/solver/push-fold/mix/session", { attemptId: ATTEMPT_ID, questionIndex: 0 }))).status).toBe(409);
    // Unknown node keeps its existing 400 for FULL.
    expect((await preflopSession(post("/api/academy/solver/preflop/session", { datasetId: "external_mtt_preflop_9max_40bb_v1", nodeKey: "NOPE", attemptId: ATTEMPT_ID, questionIndex: 0 }))).status).toBe(400);
  });
});

describe("route audit: every Academy API that serves training data enforces access", () => {
  const apiRoot = path.join(process.cwd(), "app/api/academy");
  const routes = fs.readdirSync(apiRoot, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith("route.ts"))
    .map((file) => file.split(path.sep).join("/"));
  // Own progress and the access tier itself carry no strategy data.
  const EXEMPT = new Set(["progress/route.ts", "access/route.ts"]);

  it("finds the routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(13);
  });

  it.each(routes.filter((route) => !EXEMPT.has(route)))("%s calls assertAcademyAccess before building a payload and maps denial to 403", (route) => {
    const source = fs.readFileSync(path.join(apiRoot, route), "utf8");
    expect(source).toContain("await assertAcademyAccess(player, ");
    expect(source).toContain("academyAccessErrorResponse(error)");
    const assertAt = source.indexOf("await assertAcademyAccess(");
    for (const builder of ["getAcademy", "revealAcademy", "submitAcademyTrainingAttempt("]) {
      const at = source.indexOf(builder, source.indexOf("export async function"));
      if (at >= 0) expect(assertAt).toBeLessThan(at);
    }
  });
});
