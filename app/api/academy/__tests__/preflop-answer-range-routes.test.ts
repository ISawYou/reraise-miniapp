/**
 * Post-answer strategy range (`rangeHands`) — answer-leak and anti-forgery
 * guarantees at the real route level (fixed-node trainer + Quick Mix).
 *
 * - QUESTION (pre-answer) responses carry hand / cards / actions / spot only:
 *   no frequencies, no resolved action, no node range.
 * - REVEAL is the only response with `rangeHands`, and it is reachable only
 *   with an authenticated player AND a valid submitted action.
 * - `rangeHands` is exactly the ONE server-resolved node's `hands` (the node
 *   the hand was scored against) — for Quick Mix always the server-derived
 *   node, whatever datasetId / nodeKey a client sends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CANONICAL_STARTING_HANDS } from "@/lib/academy/preflop";

const SECRET = "answer-range-route-secret-never-in-output";
const mockGetPlayerFromSessionServer = vi.fn();

vi.mock("@/features/auth-server", () => ({
  getPlayerFromSessionServer: mockGetPlayerFromSessionServer,
}));
vi.mock("@/lib/repositories/academy-progress", () => ({ academyProgressRepository: {} }));

const { POST: sessionPost } = await import("@/app/api/academy/solver/preflop/session/route");
const { POST: revealPost } = await import("@/app/api/academy/solver/preflop/reveal/route");
const { POST: mixSessionPost } = await import("@/app/api/academy/solver/preflop/mix/session/route");
const { POST: mixRevealPost } = await import("@/app/api/academy/solver/preflop/mix/reveal/route");
const { buildAcademyPreflopTrainerSession, requireAcademyPreflopTrainerSpot } = await import("@/lib/academy/preflop-trainer");
const { buildAcademyPreflopMixSession } = await import("@/lib/academy/preflop-mix");
const { getAcademyStrategyDataset } = await import("@/config/academy/solver-datasets");

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const DATASET_20 = "external_mtt_preflop_9max_20bb_v1";
const DATASET_40 = "external_mtt_preflop_9max_40bb_v1";
const FIXED_NODES = [
  [DATASET_20, "RFI_UTG"],
  [DATASET_40, "FACING_OPEN_BB_VS_BTN"],
] as const;

const PUBLIC_QUESTION_KEYS = ["actions", "hand", "renderedCards", "spot"];
const REVEAL_KEYS = [
  "actions", "bucket", "countsAsCorrect", "frequencies", "hand", "matchesResolvedAction", "outcome", "points",
  "primaryActions", "questionIndex", "randomizerPercent", "rangeHands", "renderedCards", "resolvedAction",
  "selectedAction", "spot",
];
/** Anything that would reveal the answer / range in a pre-answer payload. */
const QUESTION_LEAKS = ["rangeHands", "frequencies", "resolvedAction", "primaryActions", "randomizer", "\"hands\"", "outcome", SECRET];

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", cookie: "reraise_session=signed" },
  });
}

const mix = () => buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  mockGetPlayerFromSessionServer.mockReset().mockResolvedValue({ id: PLAYER_ID });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("answer leak: QUESTION payloads never carry the range (highest priority)", () => {
  it.each(FIXED_NODES)("(1) fixed-node session %s/%s: no frequencies, no rangeHands, no resolved action — all 10 questions", async (datasetId, nodeKey) => {
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      const response = await sessionPost(post("/api/academy/solver/preflop/session", { datasetId, nodeKey, attemptId: ATTEMPT_ID, questionIndex }));
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(PUBLIC_QUESTION_KEYS);
      const raw = JSON.stringify(body);
      for (const leak of QUESTION_LEAKS) expect(raw).not.toContain(leak);
      // No other hand class is named anywhere (a range would list all 169).
      const otherHands = CANONICAL_STARTING_HANDS.filter((hand) => hand !== body.hand && raw.includes(`"${hand}"`));
      expect(otherHands).toEqual([]);
    }
  });

  it("(2) Quick Mix session: no frequencies, no rangeHands, no resolved action — all 10 questions", async () => {
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      const response = await mixSessionPost(post("/api/academy/solver/preflop/mix/session", { attemptId: ATTEMPT_ID, questionIndex }));
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(PUBLIC_QUESTION_KEYS);
      const raw = JSON.stringify(body);
      for (const leak of QUESTION_LEAKS) expect(raw).not.toContain(leak);
      const otherHands = CANONICAL_STARTING_HANDS.filter((hand) => hand !== body.hand && raw.includes(`"${hand}"`));
      expect(otherHands).toEqual([]);
    }
  });

  it("(3) the range is unreachable without a submitted answer: no action / invalid action / no player → error, never rangeHands", async () => {
    const [datasetId, nodeKey] = FIXED_NODES[0];
    const attempts: Array<[string, () => Promise<Response>, number]> = [
      ["fixed, no action", () => revealPost(post("/api/academy/solver/preflop/reveal", { datasetId, nodeKey, attemptId: ATTEMPT_ID, questionIndex: 0 })), 400],
      ["fixed, bogus action", () => revealPost(post("/api/academy/solver/preflop/reveal", { datasetId, nodeKey, attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "PEEK" })), 400],
      ["mix, no action", () => mixRevealPost(post("/api/academy/solver/preflop/mix/reveal", { attemptId: ATTEMPT_ID, questionIndex: 0 })), 400],
      ["mix, null action", () => mixRevealPost(post("/api/academy/solver/preflop/mix/reveal", { attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: null })), 400],
    ];
    for (const [, call, status] of attempts) {
      const response = await call();
      expect(response.status).toBe(status);
      expect(JSON.stringify(await response.json())).not.toMatch(/rangeHands|frequencies/);
    }
    mockGetPlayerFromSessionServer.mockResolvedValue(null);
    for (const response of [
      await revealPost(post("/api/academy/solver/preflop/reveal", { datasetId, nodeKey, attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "FOLD" })),
      await mixRevealPost(post("/api/academy/solver/preflop/mix/reveal", { attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: "FOLD" })),
    ]) {
      expect(response.status).toBe(401);
      expect(JSON.stringify(await response.json())).not.toMatch(/rangeHands|frequencies/);
    }
  });
});

describe("fixed-node reveal: the exact range of the server-validated node", () => {
  it.each(FIXED_NODES)("%s/%s: rangeHands === node.hands (169 hands, exact), rangeHands[hand] === frequencies, nothing else", async (datasetId, nodeKey) => {
    const session = buildAcademyPreflopTrainerSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId, nodeKey });
    const stored = getAcademyStrategyDataset(datasetId).nodes[nodeKey].hands;
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      const selectedAction = session[questionIndex].actions[0].code;
      const response = await revealPost(post("/api/academy/solver/preflop/reveal", { datasetId, nodeKey, attemptId: ATTEMPT_ID, questionIndex, selectedAction }));
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown> & { hand: string; rangeHands: Record<string, Record<string, number>> };
      expect(Object.keys(body).sort()).toEqual(REVEAL_KEYS);
      expect(body.rangeHands).toEqual(stored);
      expect(Object.keys(body.rangeHands).sort()).toEqual([...CANONICAL_STARTING_HANDS].sort());
      expect(body.rangeHands[body.hand]).toEqual(body.frequencies);
      // Only the one node: no dataset / provenance / manifest / other-node data.
      expect(JSON.stringify(body)).not.toMatch(/provenance|manifest|nodeSources|actionCodes|"nodes"|"metadata"|"assumptions"/);
    }
  });
});

describe("Quick Mix reveal: the range always belongs to the SERVER-derived node", () => {
  it("each question's range is that question's server node (player, attemptId, questionIndex) — never another question's", async () => {
    const session = mix();
    expect(new Set(session.map((question) => `${question.spot.datasetId}:${question.spot.nodeKey}`)).size).toBeGreaterThan(1);
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      const expected = session[questionIndex];
      const response = await mixRevealPost(post("/api/academy/solver/preflop/mix/reveal", {
        attemptId: ATTEMPT_ID, questionIndex, selectedAction: expected.actions[0].code,
      }));
      const body = await response.json() as { hand: string; spot: { nodeKey: string; datasetId: string }; frequencies: unknown; rangeHands: Record<string, unknown> };
      const serverNode = requireAcademyPreflopTrainerSpot(expected.spot.datasetId, expected.spot.nodeKey).node;
      expect(body.spot).toMatchObject({ datasetId: expected.spot.datasetId, nodeKey: expected.spot.nodeKey });
      expect(body.rangeHands).toEqual(serverNode.hands);
      expect(body.rangeHands[body.hand]).toEqual(body.frequencies);
    }
  });

  it("ADVERSARIAL: a forged datasetId / nodeKey (and playerId) in the reveal body cannot change which range comes back", async () => {
    const session = mix();
    const forged = requireAcademyPreflopTrainerSpot(DATASET_20, "RFI_UTG");
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      const expected = session[questionIndex];
      const honest = await (await mixRevealPost(post("/api/academy/solver/preflop/mix/reveal", {
        attemptId: ATTEMPT_ID, questionIndex, selectedAction: expected.actions[0].code,
      }))).json() as { rangeHands: unknown };
      // Forge a node that differs from the server's for this question.
      const forgedTarget = expected.spot.nodeKey === "RFI_UTG" && expected.spot.datasetId === DATASET_20
        ? { datasetId: DATASET_40, nodeKey: "FACING_OPEN_BB_VS_BTN" }
        : { datasetId: DATASET_20, nodeKey: "RFI_UTG" };
      const response = await mixRevealPost(post("/api/academy/solver/preflop/mix/reveal", {
        attemptId: ATTEMPT_ID, questionIndex, selectedAction: expected.actions[0].code,
        ...forgedTarget, playerId: "99999999-9999-4999-8999-999999999999",
        rangeHands: forged.node.hands,
      }));
      expect(response.status).toBe(200);
      const body = await response.json() as { spot: { nodeKey: string; datasetId: string }; rangeHands: unknown };
      const serverNode = requireAcademyPreflopTrainerSpot(expected.spot.datasetId, expected.spot.nodeKey).node;
      const forgedNode = requireAcademyPreflopTrainerSpot(forgedTarget.datasetId, forgedTarget.nodeKey).node;
      expect(body.spot).toMatchObject({ datasetId: expected.spot.datasetId, nodeKey: expected.spot.nodeKey });
      expect(body.rangeHands).toEqual(serverNode.hands);
      expect(body.rangeHands).toEqual(honest.rangeHands);
      expect(body.rangeHands).not.toEqual(forgedNode.hands);
    }
  });
});

describe("reveal payload size (performance guard)", () => {
  it("adds only the one node's 169-hand map (a few KB), measured for a 2-action and a 3-action node", async () => {
    for (const [datasetId, nodeKey] of FIXED_NODES) {
      const session = buildAcademyPreflopTrainerSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId, nodeKey });
      const response = await revealPost(post("/api/academy/solver/preflop/reveal", {
        datasetId, nodeKey, attemptId: ATTEMPT_ID, questionIndex: 0, selectedAction: session[0].actions[0].code,
      }));
      const text = await response.text();
      const body = JSON.parse(text) as Record<string, unknown>;
      const { rangeHands, ...before } = body;
      const after = Buffer.byteLength(text);
      const withoutRange = Buffer.byteLength(JSON.stringify(before));
      const delta = after - withoutRange;
      process.stderr.write(`\n[payload] ${datasetId}/${nodeKey}: reveal ${withoutRange} B → ${after} B (+${delta} B)\n`);
      expect(delta).toBe(Buffer.byteLength(JSON.stringify(rangeHands)) + Buffer.byteLength(',"rangeHands":'));
      expect(delta).toBeLessThan(10_000);
    }
  });
});
