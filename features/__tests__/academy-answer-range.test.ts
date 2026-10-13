/**
 * `rangeHands` in the normal preflop reveal (fixed node + Quick Mix): it is
 * the very `node.hands` object of the server-resolved node the hand was
 * scored against — never recomputed, never chosen by the client — and the
 * public question never carries it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/repositories", () => ({ academyProgressRepository: {} }));
vi.mock("@/lib/repositories/academy-progress", () => ({ academyProgressRepository: {} }));

const {
  getAcademyPreflopMixQuestion,
  getAcademyPreflopTrainerQuestion,
  revealAcademyPreflopMixAnswer,
  revealAcademyPreflopTrainerAnswer,
} = await import("@/features/academy");
const {
  buildAcademyPreflopTrainerSession,
  requireAcademyPreflopTrainerSpot,
  toPreflopTrainerReveal,
  toPublicPreflopTrainerQuestion,
} = await import("@/lib/academy/preflop-trainer");
const { buildAcademyPreflopMixSession } = await import("@/lib/academy/preflop-mix");

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PLAYER_ID = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const DATASET_20 = "external_mtt_preflop_9max_20bb_v1";
const DATASET_40 = "external_mtt_preflop_9max_40bb_v1";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "answer-range-feature-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("fixed-node trainer", () => {
  it.each([
    [DATASET_20, "RFI_UTG"],
    [DATASET_40, "FACING_OPEN_BB_VS_BTN"],
  ])("%s/%s: reveal.rangeHands IS resolved.node.hands (same object) and reveal.rangeHands[hand] equals reveal.frequencies", (datasetId, nodeKey) => {
    const resolved = requireAcademyPreflopTrainerSpot(datasetId, nodeKey);
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      const question = getAcademyPreflopTrainerQuestion(PLAYER_ID, { datasetId, nodeKey, attemptId: ATTEMPT_ID, questionIndex });
      expect(question).not.toHaveProperty("rangeHands");
      expect(question).not.toHaveProperty("frequencies");
      const reveal = revealAcademyPreflopTrainerAnswer(PLAYER_ID, {
        datasetId, nodeKey, attemptId: ATTEMPT_ID, questionIndex, selectedAction: question.actions[0].code,
      });
      expect(reveal.rangeHands).toBe(resolved.node.hands);
      expect(reveal.rangeHands[reveal.hand]).toBe(reveal.frequencies);
    }
  });

  it("toPublicPreflopTrainerQuestion whitelists fields: the session question's range never reaches it", () => {
    const session = buildAcademyPreflopTrainerSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId: DATASET_20, nodeKey: "RFI_UTG" });
    for (const question of session) {
      expect(question.rangeHands).toBeDefined();
      const publicQuestion = toPublicPreflopTrainerQuestion(question);
      expect(Object.keys(publicQuestion).sort()).toEqual(["actions", "hand", "renderedCards", "spot"]);
      expect(JSON.stringify(publicQuestion)).not.toMatch(/rangeHands|frequencies|resolvedAction/);
      expect(toPreflopTrainerReveal(question, "FOLD").rangeHands).toBe(question.rangeHands);
    }
  });
});

describe("Quick Mix", () => {
  it("each reveal's range IS the server-derived node of (player, attemptId, questionIndex)", () => {
    const session = buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      const question = getAcademyPreflopMixQuestion(PLAYER_ID, { attemptId: ATTEMPT_ID, questionIndex });
      expect(question).not.toHaveProperty("rangeHands");
      const reveal = revealAcademyPreflopMixAnswer(PLAYER_ID, { attemptId: ATTEMPT_ID, questionIndex, selectedAction: question.actions[0].code });
      const serverNode = requireAcademyPreflopTrainerSpot(session[questionIndex].spot.datasetId, session[questionIndex].spot.nodeKey).node;
      expect(reveal.spot.nodeKey).toBe(session[questionIndex].spot.nodeKey);
      expect(reveal.rangeHands).toBe(serverNode.hands);
      expect(reveal.rangeHands[reveal.hand]).toBe(reveal.frequencies);
    }
  });

  it("ADVERSARIAL: forged datasetId / nodeKey / rangeHands on the reveal input are ignored — the scored hand and the shown range share one server node", () => {
    const session = buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    const forgedNode = requireAcademyPreflopTrainerSpot(DATASET_40, "FACING_OPEN_BB_VS_BTN").node;
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      const expected = session[questionIndex];
      const forgedInput = {
        attemptId: ATTEMPT_ID,
        questionIndex,
        selectedAction: expected.actions[0].code,
        datasetId: DATASET_40,
        nodeKey: "FACING_OPEN_BB_VS_BTN",
        rangeHands: forgedNode.hands,
      } as Parameters<typeof revealAcademyPreflopMixAnswer>[1];
      const reveal = revealAcademyPreflopMixAnswer(PLAYER_ID, forgedInput);
      const serverNode = requireAcademyPreflopTrainerSpot(expected.spot.datasetId, expected.spot.nodeKey).node;
      expect(reveal.rangeHands).toBe(serverNode.hands);
      expect(reveal.frequencies).toBe(serverNode.hands[reveal.hand]);
      if (serverNode !== forgedNode) expect(reveal.rangeHands).not.toBe(forgedNode.hands);
    }
  });

  it("the range is bound to the authenticated player's own mix: another player's attempt derives its own nodes", () => {
    const mine = buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    const theirs = buildAcademyPreflopMixSession({ playerId: OTHER_PLAYER_ID, attemptId: ATTEMPT_ID });
    for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
      const reveal = revealAcademyPreflopMixAnswer(OTHER_PLAYER_ID, { attemptId: ATTEMPT_ID, questionIndex, selectedAction: theirs[questionIndex].actions[0].code });
      expect(reveal.rangeHands).toBe(requireAcademyPreflopTrainerSpot(theirs[questionIndex].spot.datasetId, theirs[questionIndex].spot.nodeKey).node.hands);
    }
    expect(mine.map((question) => question.spot.nodeKey)).not.toEqual(theirs.map((question) => question.spot.nodeKey));
  });
});
