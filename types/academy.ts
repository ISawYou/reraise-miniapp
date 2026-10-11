export type AcademyGame = "NLHE";

export type AcademyFormat = "MTT";

export type AcademyStrategyModel = "CHIP_EV";

export type PreflopSpot = "RFI";

export type PreflopPosition = "UTG" | "EP" | "MP1" | "MP2" | "HJ" | "CO" | "BTN";

/**
 * Persisted Academy lesson identifier (`academy_lesson_progress.lesson_code`,
 * `academy_training_attempts.lesson_code`, both unconstrained `text`).
 *
 * Deliberately an open string: the catalog (`config/academy/catalog.ts`) is the
 * runtime source of truth for which codes exist, so adding a lesson must not
 * require editing this core type. Unknown codes are rejected at runtime by the
 * catalog lookup (fail closed), not by the type system.
 */
export type AcademyLessonCode = string;

/** The seven canonical, already-persisted preflop RFI lesson codes. */
export type AcademyPreflopRfiLessonCode = `preflop_rfi_9max_100bb_${Lowercase<PreflopPosition>}`;

export type PreflopAction = "OPEN" | "FOLD";

export type HandRank = "A" | "K" | "Q" | "J" | "T" | "9" | "8" | "7" | "6" | "5" | "4" | "3" | "2";

export type StartingHandClass =
  | `${HandRank}${HandRank}`
  | `${HandRank}${HandRank}${"s" | "o"}`;

export type PreflopReferenceStrategy = Readonly<Partial<Record<StartingHandClass, number>>>;

export type AcademyPreflopRange = {
  readonly code: `rfi_9max_100bb_${Lowercase<PreflopPosition>}`;
  readonly game: AcademyGame;
  readonly format: AcademyFormat;
  readonly tableSize: 9;
  readonly effectiveStackBb: 100;
  readonly spot: PreflopSpot;
  readonly position: PreflopPosition;
  readonly assumptions: {
    readonly model: AcademyStrategyModel;
    readonly approximate: true;
    readonly antePerPlayerBb: 0.1;
    readonly anteTotalBb: 0.9;
    readonly openSizeBb: 2.25;
    readonly rake: "RAKELESS";
  };
  readonly source: {
    readonly provider: "HRC";
    readonly scenario: "Scenario B: 100bb deepstacked";
    readonly sourcePosition: Exclude<PreflopPosition, "BTN"> | "BU";
    readonly rangeUrl: string;
    readonly contextUrl: string;
    readonly reportedWeightedRangePercentage: number;
    readonly provenanceNote: string;
  };
  readonly referenceStrategy: PreflopReferenceStrategy;
};

export type PreflopMatrixCell = {
  readonly row: number;
  readonly column: number;
  readonly hand: StartingHandClass;
  readonly referenceFrequency: number;
  readonly teachingAction: PreflopAction;
  readonly combinationCount: 4 | 6 | 12;
};

export type TeachingRangeStats = {
  readonly teachingOpenComboCount: number;
  readonly teachingOpenPercentage: number;
};

export type AcademyTrainingBucket =
  | "CORE_OPEN"
  | "OPEN_BOUNDARY"
  | "FOLD_BOUNDARY"
  | "CLEAR_FOLD";

export type PlayingCardSuit = "♠" | "♥" | "♦" | "♣";

export type RenderedPlayingCard = {
  readonly rank: HandRank;
  readonly suit: PlayingCardSuit;
  readonly color: "red" | "black";
};

export type AcademyTrainingQuestion = {
  readonly hand: StartingHandClass;
  readonly referenceFrequency: number;
  readonly bucket: AcademyTrainingBucket;
  readonly correctAction: PreflopAction;
  readonly boundaryDistance: number | null;
  readonly educationalPriority: 1 | 2 | 3 | 4;
  readonly cards: readonly [RenderedPlayingCard, RenderedPlayingCard];
};

export type AcademyTrainingSession = {
  readonly position: PreflopPosition;
  readonly questions: readonly AcademyTrainingQuestion[];
};

export type AcademyTrainingResult = {
  readonly correctAnswers: number;
  readonly totalQuestions: number;
  readonly percentage: number;
  readonly passed: boolean;
  readonly feedback: "Отлично" | "Пройдено" | "Стоит повторить диапазон";
};

export type AcademyLessonProgress = {
  readonly lessonCode: AcademyLessonCode;
  readonly attemptsCount: number;
  readonly lastScorePercent: number;
  readonly bestScorePercent: number;
  readonly passed: boolean;
  readonly firstCompletedAt: string | null;
  readonly lastAttemptAt: string;
};

export type AcademyCourseProgress = {
  readonly passedLessons: number;
  readonly totalLessons: number;
  readonly progressPercent: number;
};

/** Generic passed/total summary over an explicit lesson collection. */
export type AcademyLessonCollectionProgress = AcademyCourseProgress;

export type AcademyModuleProgress = AcademyLessonCollectionProgress & {
  readonly moduleCode: string;
};

/**
 * Presentation kind of a catalog lesson. Phase 1 has exactly one real kind:
 * a preflop raise-first-in lesson (theory + range grid).
 */
export type AcademyLessonKind = "PREFLOP_RFI" | "PREFLOP_TRAINER" | "PUSH_FOLD_TRAINER";

/**
 * Interaction/validation kind of a lesson's trainer. Each member must have a
 * registered server verifier (see `ACADEMY_TRAINER_VERIFIERS` in
 * `features/academy.ts`).
 * - `PREFLOP_RFI_BINARY`: the original OPEN/FOLD preflop RFI trainer (База MTT).
 * - `PREFLOP_RFI_FREQUENCY`: the Solver Lab frequency-aware RFI trainer, scored
 *   against a server-derived randomizer outcome per hand.
 * - `PREFLOP_CONFIGURABLE_FREQUENCY`: the configurable Solver Lab preflop
 *   trainer (player-chosen stack / situation / seats → one dataset node, any
 *   number of actions), scored the same way. One lesson code for all spots.
 * - `PUSH_FOLD_PURE`: the Solver Lab Push/Fold trainer (HoldemMath push/fold
 *   charts, pure shove/call-or-fold ranges). One lesson code for all spots.
 */
export type AcademyTrainerKind =
  | "PREFLOP_RFI_BINARY"
  | "PREFLOP_RFI_FREQUENCY"
  | "PREFLOP_CONFIGURABLE_FREQUENCY"
  | "PUSH_FOLD_PURE";

export type AcademyLesson = {
  readonly code: AcademyLessonCode;
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
  readonly order: number;
  readonly route: string;
  readonly lessonKind: AcademyLessonKind;
  readonly trainerKind: AcademyTrainerKind;
};

export type AcademyModule = {
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly order: number;
  readonly route: string;
  readonly lessons: readonly AcademyLesson[];
};

export type AcademyCourse = {
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly order: number;
  readonly modules: readonly AcademyModule[];
};

export type AcademyAdminLessonProgress = {
  readonly lessonCode: AcademyLessonCode;
  readonly title: string;
  readonly progress: AcademyLessonProgress | null;
};

export type AcademyAdminPlayerProgress = {
  readonly player: {
    readonly id: string;
    readonly displayName: string;
    readonly username: string | null;
    readonly avatarUrl: string | null;
  };
  readonly passedLessons: number;
  readonly totalLessons: number;
  readonly lastActivityAt: string;
  /** Flat list of every catalog lesson (kept for backward compatibility). */
  readonly lessons: readonly AcademyAdminLessonProgress[];
  /** Same lessons grouped by catalog course → module. */
  readonly courses: readonly AcademyAdminCourseProgress[];
};

export type AcademyAdminModuleProgress = {
  readonly moduleCode: string;
  readonly title: string;
  readonly passedLessons: number;
  readonly totalLessons: number;
  readonly lessons: readonly AcademyAdminLessonProgress[];
};

export type AcademyAdminCourseProgress = {
  readonly courseCode: string;
  readonly title: string;
  readonly passedLessons: number;
  readonly totalLessons: number;
  readonly modules: readonly AcademyAdminModuleProgress[];
};

export type AcademyAdminProgressPayload = {
  readonly summary: {
    readonly startedPlayers: number;
    readonly passedPlayers: number;
  };
  readonly players: readonly AcademyAdminPlayerProgress[];
};

export type AcademyTrainingAnswer = {
  readonly hand: StartingHandClass;
  readonly selectedAction: PreflopAction;
};

// ---------------------------------------------------------------------------
// Solver strategy datasets (generic platform)
//
// Nothing below assumes 9-max, 100 BB, RFI, Raise/Fold, HRC or a single
// dataset: those are VALUES of the current dataset, not types. Codes are
// stable open strings (validated at runtime), not closed enums, so a future
// import (e.g. 30 BB multi-action MTT) needs no type redesign.
// ---------------------------------------------------------------------------

/**
 * Stable strategy action code inside a dataset (e.g. `"RAISE_2_25BB"`,
 * `"FOLD"`, `"CALL"`, `"ALL_IN"`). The CODE — never the kind or label — is the
 * identity used by frequencies, sessions, the resolver and answers.
 */
export type AcademyStrategyActionCode = string;

/** Generic, reusable poker action vocabulary. */
export type AcademyStrategyActionKind = "FOLD" | "CHECK" | "CALL" | "BET" | "RAISE" | "ALL_IN";

/**
 * Optional localized display copy for one action (Russian UI). Pure
 * presentation: never part of the strategy content fingerprint.
 */
export type AcademyStrategyActionLocalizedCopy = {
  /** Button text, e.g. "Рейз 2.25 BB". */
  readonly button: string;
  /** Inline text inside a sentence, e.g. "рейз 2.25 BB". */
  readonly inline: string;
  /** Short name used in frequency splits, e.g. "рейз". */
  readonly short: string;
  /** Predicate for a pure (100%) strategy, e.g. "всегда открываем рейзом". */
  readonly always?: string;
};

export type AcademyStrategyActionDefinition = {
  readonly code: AcademyStrategyActionCode;
  readonly kind: AcademyStrategyActionKind;
  /** Canonical (English) label, e.g. "Raise 2.25 BB". */
  readonly label: string;
  /** Bet/raise size in big blinds, when the action has a size. */
  readonly amountBb?: number;
  /** Russian display copy; UIs fall back to `label` when absent. */
  readonly ru?: AcademyStrategyActionLocalizedCopy;
};

/**
 * Generic description of what a dataset models. All open string/number
 * codes, e.g. `{game: "NLHE", format: "MTT", strategyModel: "CHIP_EV",
 * tableSize: 9, effectiveStackBb: 100, spotCode: "RFI"}`.
 */
export type AcademyStrategyMetadata = {
  readonly game: string;
  readonly format: string;
  readonly strategyModel: string;
  readonly tableSize: number;
  readonly effectiveStackBb: number;
  readonly spotCode: string;
};

/** Free-form scalar assumptions (ante, rake, sizing, ...). */
export type AcademyStrategyAssumptions = Readonly<Record<string, string | number | boolean>>;

export type AcademyStrategyProvenance = {
  /** Upstream provider/tool, e.g. "HRC". */
  readonly provider: string;
  /** Upstream scenario/source description. */
  readonly scenario: string;
  /** Human provenance note (caveats, approximations). */
  readonly note: string;
  /** How this dataset was derived from the upstream source. */
  readonly derivation: string;
  /** Named reference URLs, e.g. `{rangeUrl, contextUrl}`. */
  readonly references: Readonly<Record<string, string>>;
  /** Optional per-node upstream details (e.g. upstream position naming). */
  readonly nodeSources?: Readonly<Record<string, Readonly<Record<string, string | number>>>>;
};

/** Identifies one decision point inside a dataset (e.g. "UTG", "BB_VS_BTN_OPEN"). */
export type AcademyStrategyNodeKey = string;

/** Action code → frequency in [0, 1]; frequencies of one hand sum to 1. */
export type AcademyStrategyHandFrequencies = Readonly<Record<AcademyStrategyActionCode, number>>;

/** All 169 canonical hand classes → action frequencies for one node. */
export type AcademyStrategyNodeHands = Readonly<Record<StartingHandClass, AcademyStrategyHandFrequencies>>;

/**
 * @deprecated Alias kept for existing call sites; a node's hand map is not
 * tied to a position.
 */
export type AcademyStrategyPositionFrequencies = AcademyStrategyNodeHands;

/** One decision point: every hand class's strategy over the node's actions. */
export type AcademyStrategyNode = {
  readonly key: AcademyStrategyNodeKey;
  /**
   * Action codes available at this node, in the dataset's declared relative
   * order. This order is the resolver's cumulative-walk order.
   */
  readonly actionCodes: readonly AcademyStrategyActionCode[];
  readonly hands: AcademyStrategyNodeHands;
};

/**
 * Versioned, provenance-carrying strategy dataset (frequencies only — the
 * runtime model intentionally carries no EV).
 */
export type AcademyStrategyDataset = {
  /** Immutable dataset id. A strategy change must ship under a new id. */
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly metadata: AcademyStrategyMetadata;
  readonly provenance: AcademyStrategyProvenance;
  readonly assumptions: AcademyStrategyAssumptions;
  /** Every action definition used by any node, in canonical order. */
  readonly actions: readonly AcademyStrategyActionDefinition[];
  readonly nodes: Readonly<Record<AcademyStrategyNodeKey, AcademyStrategyNode>>;
};

/**
 * Selects the strategy a lesson trains. Deliberately a small node-key
 * abstraction (no action-tree model): RFI lessons select a position node;
 * a future spot can select any other node key.
 */
export type AcademyStrategyNodeSelector = {
  readonly nodeKey: AcademyStrategyNodeKey;
};

/** Canonical lesson → dataset → node binding for frequency trainers. */
export type AcademySolverLessonBinding = {
  readonly lessonCode: AcademyLessonCode;
  readonly datasetId: string;
  readonly selector: AcademyStrategyNodeSelector;
  /** Action whose frequency defines the sampler's pure/mixed buckets. */
  readonly primaryActionCode: AcademyStrategyActionCode;
};

/**
 * Selected/resolved action code in a Solver Lab session. Open string: valid
 * codes are the bound node's `actionCodes` (validated at runtime).
 */
export type AcademySolverAction = AcademyStrategyActionCode;

/** Composition bucket of a hand for the Solver Lab balanced sampler. */
export type AcademySolverHandBucket = "MIXED" | "PURE_RAISE" | "PURE_FOLD";

/**
 * Safe, answer-free action display metadata sent with every question. Same
 * for every question of a node, so it reveals nothing about the answer.
 */
export type AcademySolverPublicAction = {
  readonly code: AcademyStrategyActionCode;
  readonly kind: AcademyStrategyActionKind;
  readonly label: string;
  readonly amountBb?: number;
  readonly ru?: AcademyStrategyActionLocalizedCopy;
};

/**
 * What `POST /api/academy/solver/session` returns for one question: the hand,
 * the server-derived randomizer and the available actions' display metadata —
 * never frequencies, the resolved action, EV or any derivation input.
 */
export type AcademySolverPublicQuestion = {
  readonly hand: StartingHandClass;
  readonly renderedCards: readonly [RenderedPlayingCard, RenderedPlayingCard];
  /** Integer in [0, 99]. See `resolveActionFromFrequencies` for semantics. */
  readonly randomizerPercent: number;
  /** Available actions in resolver order. */
  readonly actions: readonly AcademySolverPublicAction[];
};

/** Returned only after the player has answered a question. */
export type AcademySolverQuestionReveal = AcademySolverPublicQuestion & {
  readonly questionIndex: number;
  readonly frequencies: AcademyStrategyHandFrequencies;
  readonly resolvedAction: AcademySolverAction;
  readonly selectedAction: AcademySolverAction;
  readonly bucket: AcademySolverHandBucket;
  readonly matchesResolvedAction: boolean;
};

/** One submitted Solver Lab answer; only `selectedAction` is trusted. */
export type AcademySolverAnswer = {
  readonly questionIndex: number;
  readonly selectedAction: AcademySolverAction;
};

// ---------------------------------------------------------------------------
// Configurable preflop trainer (Solver Lab · "Префлоп-тренажёр")
// ---------------------------------------------------------------------------

/**
 * Generic, strategy-neutral sampler bucket of a hand at a node with any
 * number of actions: `PURE:<actionCode>` when one action has frequency 1
 * (within `ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON`), otherwise `MIXED`.
 */
export type AcademyStrategyHandBucket = "MIXED" | `PURE:${AcademyStrategyActionCode}`;

/** Decision situation of a preflop trainer node (values of the dataset's node sources). */
export type AcademyPreflopTrainerSituation =
  | "RFI"
  | "FACING_OPEN"
  | "FACING_3BET"
  | "FACING_4BET"
  | "FACING_5BET";

/**
 * One selectable trainer spot = one real, validated dataset node. Derived at
 * runtime from the registered datasets (never a hand-written copy). Contains
 * no frequencies and no action codes, so it is safe to send to the client.
 */
export type AcademyPreflopTrainerSpot = {
  readonly datasetId: string;
  readonly nodeKey: AcademyStrategyNodeKey;
  readonly stackBb: number;
  readonly situation: AcademyPreflopTrainerSituation;
  readonly heroPosition: string;
  /** Absent for first-in (RFI) spots. */
  readonly villainPosition?: string;
  /** Number of actions the node offers (2-4); not answer-revealing. */
  readonly actionCount: number;
};

/** Russian, answer-free copy describing a spot. */
export type AcademyPreflopTrainerSpotCopy = {
  /** e.g. "BB против BTN". */
  readonly title: string;
  /** e.g. "BTN открыл — ты на BB". */
  readonly history: string;
  /** e.g. "Против открытия". */
  readonly situationLabel: string;
};

/**
 * Role of one seat in a trainer table scene. Lower-case display roles (never
 * strategy action codes) so a public payload carries no action code outside
 * its `actions` list.
 */
export type AcademyPreflopTableSeatRole = "hero" | "villain" | "folded" | "waiting";

/** One seat of a table scene, in 9-max seat order (UTG … BB). */
export type AcademyPreflopTableSceneSeat = {
  /** Trainer seat code ("UTG", "UTG1", …, "BB"). */
  readonly seat: string;
  readonly role: AcademyPreflopTableSeatRole;
  /**
   * Short Russian label of the seat's most recent action BEFORE the decision
   * ("Фолд", "Рейз", "3-бет", "Олл-ин"). Only actions implied by the node's own
   * situation / hero / villain; never a size.
   */
  readonly actionLabel?: string;
};

/**
 * Answer-free picture of a spot on the 9-max table: who the hero is, who
 * the aggressor is, and which earlier actions the node itself implies.
 */
export type AcademyPreflopTableScene = {
  readonly heroSeat: string;
  readonly villainSeat?: string;
  readonly seats: readonly AcademyPreflopTableSceneSeat[];
};

/** Public spot: descriptor + Russian copy + table scene (no frequencies). */
export type AcademyPreflopTrainerPublicSpot = AcademyPreflopTrainerSpot & AcademyPreflopTrainerSpotCopy & {
  readonly scene: AcademyPreflopTableScene;
};

/**
 * Server-computed three-state outcome of one answer in the NORMAL practice
 * trainers (configurable preflop trainer, Quick Mix, Push/Fold):
 * - `RESOLVED_MATCH`: the choice equals the randomizer-resolved action;
 * - `VALID_MIXED`: a different action the strategy also plays (> 0%) — counts
 *   as correct, never a mistake;
 * - `NOT_IN_STRATEGY`: the strategy never plays the chosen action (0%).
 * Not used by the 100bb HRC Solver Lab trainer (exact-randomizer scoring).
 */
export type AcademyStrategyAnswerOutcome = "RESOLVED_MATCH" | "VALID_MIXED" | "NOT_IN_STRATEGY";

/**
 * Public question of the configurable trainer: hand, cards, actions and spot.
 * Deliberately WITHOUT the randomizer: in normal practice the player answers
 * from the strategy, and the randomizer is only explained after answering.
 */
export type AcademyPreflopTrainerPublicQuestion = Omit<AcademySolverPublicQuestion, "randomizerPercent"> & {
  readonly spot: AcademyPreflopTrainerPublicSpot;
};

/** Returned only after the player answered one configurable-trainer question. */
export type AcademyPreflopTrainerReveal = AcademyPreflopTrainerPublicQuestion & {
  readonly questionIndex: number;
  readonly frequencies: AcademyStrategyHandFrequencies;
  /** Integer in [0, 99] — secondary, explanatory information only. */
  readonly randomizerPercent: number;
  readonly resolvedAction: AcademySolverAction;
  readonly selectedAction: AcademySolverAction;
  readonly bucket: AcademyStrategyHandBucket;
  readonly matchesResolvedAction: boolean;
  /** Server-computed; see `AcademyStrategyAnswerOutcome`. */
  readonly outcome: AcademyStrategyAnswerOutcome;
  /** Server-computed: true iff the verifier counts this answer as correct. */
  readonly countsAsCorrect: boolean;
};

/**
 * One submitted configurable-trainer answer. The selection (`datasetId`,
 * `nodeKey`) travels with every answer and is re-validated against the
 * registry server-side; only `selectedAction` is scored.
 */
export type AcademyPreflopTrainerAnswer = AcademySolverAnswer & {
  readonly datasetId: string;
  readonly nodeKey: AcademyStrategyNodeKey;
};

/**
 * One submitted Quick Mix answer (marker `mode: "QUICK_MIX"`, same lesson
 * code as the fixed-node trainer). `datasetId` / `nodeKey` echo the node the
 * SERVER derived for that question; the verifier re-derives it and rejects
 * any mismatch. Only `selectedAction` is scored.
 */
export type AcademyPreflopQuickMixAnswer = AcademyPreflopTrainerAnswer & {
  readonly mode: "QUICK_MIX";
};

// ---------------------------------------------------------------------------
// Push/Fold trainer (Solver Lab · "Push/Fold")
// ---------------------------------------------------------------------------

/**
 * Decision family of a Push/Fold node (values of the dataset's node sources):
 * - `FIRST_IN_SHOVE`: everyone before hero folded; hero shoves or folds.
 * - `CALL_VS_SHOVE`: one seat shoved first in, everyone between folded; hero
 *   calls or folds.
 */
export type AcademyPushFoldSituation = "FIRST_IN_SHOVE" | "CALL_VS_SHOVE";

/**
 * One selectable Push/Fold spot = one real, validated dataset node. Contains
 * no frequencies and no range coverage, so it is safe in a question payload.
 */
export type AcademyPushFoldSpot = {
  readonly datasetId: string;
  readonly nodeKey: AcademyStrategyNodeKey;
  readonly stackBb: number;
  readonly situation: AcademyPushFoldSituation;
  readonly heroPosition: string;
  /** The shover; absent for first-in spots. */
  readonly villainPosition?: string;
};

/** Russian, answer-free copy describing a Push/Fold spot. */
export type AcademyPushFoldSpotCopy = {
  /** e.g. "BB против пуша SB". */
  readonly title: string;
  /** e.g. "SB пошёл олл-ин — ты на BB". */
  readonly history: string;
  /** "Пушить первым" / "Коллировать пуш". */
  readonly situationLabel: string;
};

/** Public spot: descriptor + Russian copy + table scene (no frequencies). */
export type AcademyPushFoldPublicSpot = AcademyPushFoldSpot & AcademyPushFoldSpotCopy & {
  readonly scene: AcademyPreflopTableScene;
};

/**
 * Public Push/Fold question: the hand and the node's actions — never the
 * frequencies, the correct action or any derivation input. (No randomizer:
 * push/fold ranges are pure, so there is nothing to randomize.)
 */
export type AcademyPushFoldPublicQuestion = {
  readonly hand: StartingHandClass;
  readonly renderedCards: readonly [RenderedPlayingCard, RenderedPlayingCard];
  readonly actions: readonly AcademySolverPublicAction[];
  readonly spot: AcademyPushFoldPublicSpot;
};

/** Returned only after the player answered one Push/Fold question. */
export type AcademyPushFoldReveal = AcademyPushFoldPublicQuestion & {
  readonly questionIndex: number;
  readonly frequencies: AcademyStrategyHandFrequencies;
  /** The node's (pure) action for this hand. */
  readonly resolvedAction: AcademySolverAction;
  readonly selectedAction: AcademySolverAction;
  readonly matchesResolvedAction: boolean;
  /** Server-computed; see `AcademyStrategyAnswerOutcome`. */
  readonly outcome: AcademyStrategyAnswerOutcome;
  /** Server-computed: true iff the verifier counts this answer as correct. */
  readonly countsAsCorrect: boolean;
};

/**
 * One submitted Push/Fold answer. Fixed-node attempts carry the selected node
 * on every answer; Quick attempts additionally carry `mode:
 * "PUSH_FOLD_QUICK"` and echo the server-derived node. Only `selectedAction`
 * is scored.
 */
export type AcademyPushFoldAnswer = AcademySolverAnswer & {
  readonly datasetId: string;
  readonly nodeKey: AcademyStrategyNodeKey;
  readonly mode?: "PUSH_FOLD_QUICK";
};
