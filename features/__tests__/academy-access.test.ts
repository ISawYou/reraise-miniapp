/**
 * Academy access model — unit level: the pure policy, the DERIVED beginner
 * spot whitelist, tier resolution (staff / season / participation) with
 * injected dependencies, and the request → target builders shared by
 * session, reveal and attempt. Participation on real rows is proven by
 * academy-access.postgres.integration.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/repositories/season", () => ({ seasonRepository: { findActive: async () => null } }));
vi.mock("@/lib/repositories/academy-access", () => ({
  academyAccessRepository: { hasPlayerParticipatedInSeason: async () => false },
}));

const { ACADEMY_BEGINNER_AFTER_OPEN_LESSONS } = await import("@/config/academy/beginner-after-open");
const {
  ACADEMY_BEGINNER_LESSON_CODES,
  ACADEMY_BEGINNER_SPOTS,
  deriveAcademyBeginnerSpots,
  isAcademyAccessAllowed,
  isAcademyBeginnerSpot,
} = await import("@/config/academy/access-policy");
const { ACADEMY_ACCESS_COPY } = await import("@/config/academy/access-copy");
const { getAcademyModule, listAllAcademyLessonCodes } = await import("@/config/academy/catalog");
const { ACADEMY_SOLVER_RFI_MODULE_CODE } = await import("@/config/academy/catalog-codes");
const { ACADEMY_ADVANCED_STUDY_SPOTS, requireAcademyDestination } = await import("@/config/academy/navigation");
const { ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, ACADEMY_PREFLOP_QUICK_MIX_MODE } = await import("@/config/academy/preflop-trainer");
const { ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE } = await import("@/config/academy/push-fold-trainer");
const { ACADEMY_TRAINING_PRESETS } = await import("@/config/academy/training-presets");
const { listAcademyPreflopTrainerSpots, requireAcademyPreflopTrainerSpotByStack } = await import("@/lib/academy/preflop-trainer");
const access = await import("@/features/academy-access");
const { AcademyValidationError } = await import("@/features/academy");

type Deps = Parameters<typeof access.getAcademyAccess>[1];

const SEASON = { id: "season-current", title: "Осень 2026" };

function deps(options: { season?: typeof SEASON | null; participated?: boolean } = {}) {
  const findActiveSeason = vi.fn(async () => (options.season === undefined ? SEASON : options.season));
  const hasPlayerParticipatedInSeason = vi.fn(async () => options.participated ?? false);
  const value: NonNullable<Deps> = { findActiveSeason, participation: { hasPlayerParticipatedInSeason } };
  return { value, findActiveSeason, hasPlayerParticipatedInSeason };
}

const player = (role: "player" | "admin" | "operator" = "player") => ({ id: "p-1", role });

/** Real (stack, node) of the configurable trainer that the beginner curriculum does NOT use. */
const NON_BEGINNER_SPOTS = [
  { stackBb: 40, nodeKey: "RFI_CO" }, // a ready-made preset ("Первый рейз"), same 40 BB stack, not beginner
  { stackBb: 20, nodeKey: "FACING_OPEN_BB_VS_BTN" }, // same node key as a beginner spot, other stack
  { stackBb: 100, nodeKey: "FACING_4BET_BTN_VS_CO" }, // "Продвинутым"
  { stackBb: 40, nodeKey: "FACING_3BET_UTG_VS_SB" }, // "Продвинутым"
];

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/config/academy/beginner-after-open");
});

describe("beginner spot whitelist — DERIVED from ACADEMY_BEGINNER_AFTER_OPEN_LESSONS", () => {
  it("contains exactly every configured main + compare spot (walks the real config)", () => {
    const walked = new Set<string>();
    for (const lesson of ACADEMY_BEGINNER_AFTER_OPEN_LESSONS) {
      walked.add(`${lesson.spot.stackBb}:${lesson.spot.nodeKey}`);
      if (lesson.compareSpot) walked.add(`${lesson.compareSpot.stackBb}:${lesson.compareSpot.nodeKey}`);
    }
    expect(new Set(ACADEMY_BEGINNER_SPOTS.map((spot) => `${spot.stackBb}:${spot.nodeKey}`))).toEqual(walked);
    expect(ACADEMY_BEGINNER_SPOTS.length).toBe(walked.size);
  });

  it("every configured main / compare spot is a real registered node and allowed for BEGINNER_ONLY (page AND API target)", () => {
    for (const lesson of ACADEMY_BEGINNER_AFTER_OPEN_LESSONS) {
      for (const ref of [lesson.spot, ...(lesson.compareSpot ? [lesson.compareSpot] : [])]) {
        const { spot } = requireAcademyPreflopTrainerSpotByStack(ref.stackBb, ref.nodeKey);
        const target = access.academyPreflopSpotTarget(spot.datasetId, spot.nodeKey);
        expect(target).toEqual({ kind: "PREFLOP_SPOT", stackBb: ref.stackBb, nodeKey: ref.nodeKey });
        expect(isAcademyAccessAllowed("BEGINNER_ONLY", target)).toBe(true);
      }
    }
  });

  it("every beginner lesson's ready-made training preset is allowed; unrelated presets are not", () => {
    for (const preset of ACADEMY_TRAINING_PRESETS.filter((entry) => entry.engine === "PREFLOP_TRAINER")) {
      expect(isAcademyBeginnerSpot(preset)).toBe(Boolean(preset.lessonSlug));
    }
  });

  it("a real registered node NOT in the beginner config is blocked for BEGINNER_ONLY (and allowed for FULL)", () => {
    for (const ref of NON_BEGINNER_SPOTS) {
      const { spot } = requireAcademyPreflopTrainerSpotByStack(ref.stackBb, ref.nodeKey);
      const target = access.academyPreflopSpotTarget(spot.datasetId, spot.nodeKey);
      expect(isAcademyAccessAllowed("BEGINNER_ONLY", target)).toBe(false);
      expect(isAcademyAccessAllowed("FULL", target)).toBe(true);
    }
  });

  it("only the beginner nodes of the whole registry are allowed (no generic access by route shape)", () => {
    const allowed = listAcademyPreflopTrainerSpots()
      .filter((spot) => isAcademyAccessAllowed("BEGINNER_ONLY", access.academyPreflopSpotTarget(spot.datasetId, spot.nodeKey)))
      .map((spot) => `${spot.stackBb}:${spot.nodeKey}`)
      .sort();
    expect(allowed).toEqual(ACADEMY_BEGINNER_SPOTS.map((spot) => `${spot.stackBb}:${spot.nodeKey}`).sort());
    expect(listAcademyPreflopTrainerSpots().length).toBeGreaterThan(allowed.length * 10);
  });

  it("a FUTURE curriculum change is followed automatically (derivation over a changed config)", () => {
    const changed = [
      ...ACADEMY_BEGINNER_AFTER_OPEN_LESSONS,
      { ...ACADEMY_BEGINNER_AFTER_OPEN_LESSONS[0], code: "x", slug: "sb-first-in" as const, spot: { stackBb: 20, nodeKey: "RFI_BTN" }, compareSpot: { stackBb: 100, nodeKey: "RFI_UTG" } },
    ];
    const derived = deriveAcademyBeginnerSpots(changed).map((spot) => `${spot.stackBb}:${spot.nodeKey}`);
    expect(derived).toContain("20:RFI_BTN");
    expect(derived).toContain("100:RFI_UTG");
  });

  it("the policy module itself re-derives from the config module (mocked curriculum → new whitelist)", async () => {
    vi.resetModules();
    vi.doMock("@/config/academy/beginner-after-open", async (importOriginal) => {
      const original = await importOriginal<typeof import("@/config/academy/beginner-after-open")>();
      return {
        ...original,
        ACADEMY_BEGINNER_AFTER_OPEN_LESSONS: [{ ...original.ACADEMY_BEGINNER_AFTER_OPEN_LESSONS[0], spot: { stackBb: 20, nodeKey: "RFI_BTN" } }],
      };
    });
    const policy = await import("@/config/academy/access-policy");
    expect(policy.ACADEMY_BEGINNER_SPOTS).toEqual([{ stackBb: 20, nodeKey: "RFI_BTN" }]);
    expect(policy.isAcademyAccessAllowed("BEGINNER_ONLY", { kind: "PREFLOP_SPOT", stackBb: 20, nodeKey: "RFI_BTN" })).toBe(true);
    expect(policy.isAcademyAccessAllowed("BEGINNER_ONLY", { kind: "PREFLOP_SPOT", stackBb: 40, nodeKey: "RFI_SB" })).toBe(false);
  });
});

describe("catalog lessons", () => {
  it("BEGINNER_ONLY may train exactly the 'Новичкам' module's lessons (derived from the destination)", () => {
    const beginnerModule = getAcademyModule(requireAcademyDestination("beginner").moduleCode!)!;
    expect(ACADEMY_BEGINNER_LESSON_CODES).toEqual(beginnerModule.lessons.map((lesson) => lesson.code));
    expect(ACADEMY_BEGINNER_LESSON_CODES.length).toBeGreaterThan(0);
    for (const code of ACADEMY_BEGINNER_LESSON_CODES) {
      expect(isAcademyAccessAllowed("BEGINNER_ONLY", { kind: "CATALOG_LESSON", lessonCode: code })).toBe(true);
    }
  });

  it("every other catalog lesson (Solver RFI, configurable trainer, Push/Fold) is FULL-only", () => {
    const rfi = getAcademyModule(ACADEMY_SOLVER_RFI_MODULE_CODE)!.lessons.map((lesson) => lesson.code);
    expect(rfi.length).toBeGreaterThan(0);
    const others = [...listAllAcademyLessonCodes(), ...rfi, ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE]
      .filter((code) => !ACADEMY_BEGINNER_LESSON_CODES.includes(code));
    expect(others.length).toBeGreaterThan(rfi.length);
    for (const code of others) {
      expect(isAcademyAccessAllowed("BEGINNER_ONLY", { kind: "CATALOG_LESSON", lessonCode: code })).toBe(false);
      expect(isAcademyAccessAllowed("FULL", { kind: "CATALOG_LESSON", lessonCode: code })).toBe(true);
    }
  });
});

describe("locked areas and unknown input fail closed", () => {
  it("every area is FULL-only", () => {
    for (const area of ["intermediate", "advanced", "trainers", "preflop-setup", "preflop-quick-mix", "push-fold", "solver-rfi", "unknown"] as const) {
      expect(isAcademyAccessAllowed("BEGINNER_ONLY", { kind: "AREA", area })).toBe(false);
      expect(isAcademyAccessAllowed("FULL", { kind: "AREA", area })).toBe(true);
    }
  });

  it("an unrecognised tier value is never treated as entitled", () => {
    const spot = ACADEMY_BEGINNER_SPOTS[0];
    expect(isAcademyAccessAllowed("ADMIN" as never, { kind: "PREFLOP_SPOT", ...spot })).toBe(false);
  });

  it("an unknown / forged dataset or node becomes the 'unknown' area", () => {
    for (const [datasetId, nodeKey] of [["nope", "RFI_SB"], ["external_mtt_preflop_9max_40bb_v1", "NOPE"], [null, null], [40, "RFI_SB"]] as const) {
      expect(access.academyPreflopSpotTarget(datasetId, nodeKey)).toEqual({ kind: "AREA", area: "unknown" });
    }
  });

  it("the advanced curated spots that are not beginner spots stay locked", () => {
    for (const entry of ACADEMY_ADVANCED_STUDY_SPOTS) {
      expect(isAcademyBeginnerSpot(entry)).toBe(ACADEMY_BEGINNER_SPOTS.some((spot) => spot.stackBb === entry.stackBb && spot.nodeKey === entry.nodeKey));
    }
  });
});

describe("getAcademyAccess — derived on every call", () => {
  it("(1) no participation → BEGINNER_ONLY with the active season", async () => {
    const d = deps({ participated: false });
    expect(await access.getAcademyAccess(player(), d.value)).toEqual({ access: "BEGINNER_ONLY", season: SEASON });
    expect(d.hasPlayerParticipatedInSeason).toHaveBeenCalledWith("p-1", SEASON.id);
  });

  it("participation in the ACTIVE season → FULL", async () => {
    expect((await access.getAcademyAccess(player(), deps({ participated: true }).value)).access).toBe("FULL");
  });

  it("(10)/(11) admin and operator → FULL without any participation query", async () => {
    for (const role of ["admin", "operator"] as const) {
      const d = deps({ participated: false });
      expect(await access.getAcademyAccess(player(role), d.value)).toEqual({ access: "FULL", season: SEASON });
      expect(d.hasPlayerParticipatedInSeason).not.toHaveBeenCalled();
    }
  });

  it("(12) no active season: ordinary player → BEGINNER_ONLY (fail closed), staff → FULL", async () => {
    const d = deps({ season: null, participated: true });
    expect(await access.getAcademyAccess(player(), d.value)).toEqual({ access: "BEGINNER_ONLY", season: null });
    expect(d.hasPlayerParticipatedInSeason).not.toHaveBeenCalled();
    expect(await access.getAcademyAccess(player("admin"), d.value)).toEqual({ access: "FULL", season: null });
    expect(await access.getAcademyAccess(player("operator"), d.value)).toEqual({ access: "FULL", season: null });
  });

  it("is never cached: a change in the facts is reflected on the very next call", async () => {
    let participated = false;
    const hasPlayerParticipatedInSeason = vi.fn(async () => participated);
    const value = { findActiveSeason: async () => SEASON, participation: { hasPlayerParticipatedInSeason } };
    expect((await access.getAcademyAccess(player(), value)).access).toBe("BEGINNER_ONLY");
    participated = true;
    expect((await access.getAcademyAccess(player(), value)).access).toBe("FULL");
    participated = false;
    expect((await access.getAcademyAccess(player(), value)).access).toBe("BEGINNER_ONLY");
    expect(hasPlayerParticipatedInSeason).toHaveBeenCalledTimes(3);
  });

  it("ordinary roles never get the staff exemption", async () => {
    expect((await access.getAcademyAccess({ id: "p", role: "player" }, deps().value)).access).toBe("BEGINNER_ONLY");
    expect((await access.getAcademyAccess({ id: "p", role: "superadmin" as never }, deps().value)).access).toBe("BEGINNER_ONLY");
  });
});

describe("assertAcademyAccess — the single enforcement call", () => {
  const beginnerSpot = { kind: "PREFLOP_SPOT" as const, ...ACADEMY_BEGINNER_SPOTS[0] };

  it("allows a beginner target for BEGINNER_ONLY and returns the view", async () => {
    await expect(access.assertAcademyAccess(player(), beginnerSpot, deps().value)).resolves.toEqual({ access: "BEGINNER_ONLY", season: SEASON });
  });

  it("denies with AcademyAccessDeniedError (403 semantics, NOT a validation error) and the stable message", async () => {
    const error = await access.assertAcademyAccess(player(), { kind: "AREA", area: "preflop-quick-mix" }, deps().value).catch((caught) => caught);
    expect(error).toBeInstanceOf(access.AcademyAccessDeniedError);
    expect(error).not.toBeInstanceOf(AcademyValidationError);
    expect(error.message).toBe(ACADEMY_ACCESS_COPY.apiDenied);
    expect(error.message).toBe("Расширенная Академия доступна после первой игры в текущем сезоне");
  });

  it("requires EVERY target (one locked answer in an otherwise beginner attempt is denied)", async () => {
    const locked = { kind: "PREFLOP_SPOT" as const, ...NON_BEGINNER_SPOTS[0] };
    await expect(access.assertAcademyAccess(player(), [beginnerSpot, locked], deps().value)).rejects.toBeInstanceOf(access.AcademyAccessDeniedError);
    await expect(access.assertAcademyAccess(player(), [], deps().value)).rejects.toBeInstanceOf(access.AcademyAccessDeniedError);
    await expect(access.assertAcademyAccess(player(), [beginnerSpot, locked], deps({ participated: true }).value)).resolves.toMatchObject({ access: "FULL" });
  });
});

describe("academyAttemptTargets — re-derived from the submitted answers, never from client context", () => {
  const beginner = requireAcademyPreflopTrainerSpotByStack(ACADEMY_BEGINNER_SPOTS[0].stackBb, ACADEMY_BEGINNER_SPOTS[0].nodeKey).spot;
  const locked = requireAcademyPreflopTrainerSpotByStack(NON_BEGINNER_SPOTS[0].stackBb, NON_BEGINNER_SPOTS[0].nodeKey).spot;
  const answer = (spot: { datasetId: string; nodeKey: string }, extra: Record<string, unknown> = {}) =>
    ({ questionIndex: 0, selectedAction: "FOLD", datasetId: spot.datasetId, nodeKey: spot.nodeKey, ...extra });

  it("configurable trainer: one target per answer, from that answer's own node", () => {
    const targets = access.academyAttemptTargets({ lessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, questions: [answer(beginner), answer(locked)] });
    expect(targets).toEqual([
      { kind: "PREFLOP_SPOT", stackBb: beginner.stackBb, nodeKey: beginner.nodeKey },
      { kind: "PREFLOP_SPOT", stackBb: locked.stackBb, nodeKey: locked.nodeKey },
    ]);
  });

  it("any Quick Mix marker → the Quick Mix area (even if nodes look like beginner nodes)", () => {
    expect(access.academyAttemptTargets({
      lessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE,
      questions: [answer(beginner, { mode: ACADEMY_PREFLOP_QUICK_MIX_MODE }), answer(beginner)],
    })).toEqual([{ kind: "AREA", area: "preflop-quick-mix" }]);
  });

  it("a client 'from=beginner' / lesson marker is ignored — only the node counts", () => {
    const targets = access.academyAttemptTargets({
      lessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE,
      questions: [answer(locked, { from: "beginner", lessonSlug: "bb-defence", preset: "bb-defence" })],
    });
    expect(targets).toEqual([{ kind: "PREFLOP_SPOT", stackBb: locked.stackBb, nodeKey: locked.nodeKey }]);
  });

  it("Push/Fold, other catalog lessons, unknown lessons and malformed answers", () => {
    expect(access.academyAttemptTargets({ lessonCode: ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE, questions: [] })).toEqual([{ kind: "AREA", area: "push-fold" }]);
    expect(access.academyAttemptTargets({ lessonCode: ACADEMY_BEGINNER_LESSON_CODES[0], questions: [] })).toEqual([{ kind: "CATALOG_LESSON", lessonCode: ACADEMY_BEGINNER_LESSON_CODES[0] }]);
    expect(access.academyAttemptTargets({ lessonCode: "nope", questions: [] })).toEqual([{ kind: "AREA", area: "unknown" }]);
    expect(access.academyAttemptTargets({ lessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, questions: [] })).toEqual([{ kind: "AREA", area: "unknown" }]);
    expect(access.academyAttemptTargets({ lessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, questions: [null] })).toEqual([{ kind: "AREA", area: "unknown" }]);
  });
});
