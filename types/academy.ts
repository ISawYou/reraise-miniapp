export type AcademyGame = "NLHE";

export type AcademyFormat = "MTT";

export type AcademyStrategyModel = "CHIP_EV";

export type PreflopSpot = "RFI";

export type PreflopPosition = "UTG" | "EP" | "MP1" | "MP2" | "HJ" | "CO" | "BTN";

export type AcademyLessonCode = `preflop_rfi_9max_100bb_${Lowercase<PreflopPosition>}`;

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
  readonly lessons: readonly AcademyAdminLessonProgress[];
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
