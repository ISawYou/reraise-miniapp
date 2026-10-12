import "server-only";

/**
 * "Новичкам · Шаг 2" lesson view models (server side).
 *
 * Nothing here is new strategy or new sizing logic:
 * - each lesson's spot is resolved through the configurable trainer's
 *   fail-closed lookup (`requireAcademyPreflopTrainerSpotByStack`) — a node
 *   that is not a real, validated node of a registered dataset throws;
 * - the table scene, stacks, chips and pot are the trainer's own public spot
 *   (`toPublicPreflopTrainerSpot`, ed52268 sizing + conservative ante policy);
 * - every number in the lesson prose is formatted from the SAME hand state
 *   the table and the action buttons use (`getPreflopTrainerSpotHandState`),
 *   never typed into the copy;
 * - every data-dependent sentence (limp, the aggressive option, in / out of
 *   position) branches on the real node's actions / seats;
 * - "Потренироваться" is the existing trainer route of that exact node.
 */
import {
  type AcademyBeginnerAfterOpenLesson,
  type AcademyBeginnerSpotRef,
  type AcademyBeginnerTermCode,
  ACADEMY_BEGINNER_AFTER_OPEN_LESSONS,
  getBeginnerAfterOpenLesson,
} from "@/config/academy/beginner-after-open";
import { preflopTrainerSpotRoute, preflopTrainerTrainRoute } from "@/config/academy/preflop-trainer";
import {
  type AcademyPreflopHandState,
  formatSizingBb,
  formatSizingBbLabel,
  isInPositionPostflop,
} from "@/lib/academy/preflop-sizing";
import {
  type AcademyPreflopTrainerResolvedSpot,
  getPreflopTrainerPublicActions,
  getPreflopTrainerSpotHandState,
  requireAcademyPreflopTrainerSpotByStack,
  toPublicPreflopTrainerSpot,
} from "@/lib/academy/preflop-trainer";
import type {
  AcademyPreflopTablePot,
  AcademyPreflopTrainerPublicSpot,
  AcademySolverPublicAction,
  AcademyStrategyNodeHands,
} from "@/types/academy";

export type AcademyBeginnerLessonFact = {
  readonly code: "VILLAIN_BET" | "HERO_IN" | "TO_CALL" | "POT" | "HERO_RAISE" | "HERO_ALL_IN" | "HERO_STACK";
  readonly label: string;
  readonly value: string;
};

/** One real spot with everything the lesson page shows for it. */
export type AcademyBeginnerLessonSpotView = {
  readonly ref: AcademyBeginnerSpotRef;
  readonly spot: AcademyPreflopTrainerPublicSpot;
  readonly actions: readonly AcademySolverPublicAction[];
  readonly hands: AcademyStrategyNodeHands;
  readonly state: AcademyPreflopHandState | null;
  /** The existing study page (range + table) of this node. */
  readonly studyHref: string;
  /** The existing scored trainer route of this node. */
  readonly practiceHref: string;
};

export type AcademyBeginnerLessonView = {
  readonly lesson: AcademyBeginnerAfterOpenLesson;
  readonly main: AcademyBeginnerLessonSpotView;
  readonly compare?: AcademyBeginnerLessonSpotView & { readonly linkLabel: string };
  /** Plain-language explanation, numbers formatted from `main.state` / `compare.state`. */
  readonly paragraphs: readonly string[];
  readonly facts: readonly AcademyBeginnerLessonFact[];
  readonly terms: readonly AcademyBeginnerTermCode[];
  readonly hasLimp: boolean;
  readonly next?: AcademyBeginnerAfterOpenLesson;
};

function resolveSpot(ref: AcademyBeginnerSpotRef): AcademyBeginnerLessonSpotView {
  const resolved: AcademyPreflopTrainerResolvedSpot = requireAcademyPreflopTrainerSpotByStack(ref.stackBb, ref.nodeKey);
  return Object.freeze({
    ref,
    spot: toPublicPreflopTrainerSpot(resolved.spot),
    actions: getPreflopTrainerPublicActions(resolved),
    hands: resolved.node.hands,
    state: getPreflopTrainerSpotHandState(resolved.spot),
    studyHref: preflopTrainerSpotRoute(resolved.spot.stackBb, resolved.spot.nodeKey),
    practiceHref: preflopTrainerTrainRoute(resolved.spot.stackBb, resolved.spot.nodeKey),
  });
}

const bb = formatSizingBbLabel;

/** "в 3 раза" / "в 4.5 раза" / "в 5 раз". */
function timesPhrase(value: number): string {
  const text = formatSizingBb(value);
  const whole = Number(text);
  return Number.isInteger(whole) && (whole < 2 || whole > 4) ? `в ${text} раз` : `в ${text} раза`;
}

function potValue(pot: AcademyPreflopTablePot | undefined): { label: string; value: string } | null {
  if (!pot) return null;
  return pot.kind === "EXACT"
    ? { label: "Банк", value: bb(pot.totalBb) }
    : { label: "Банк без анте", value: bb(pot.knownBb) };
}

function potBbOf(pot: AcademyPreflopTablePot | undefined): number | undefined {
  if (!pot) return undefined;
  return pot.kind === "EXACT" ? pot.totalBb : pot.knownBb;
}

const SEAT_TERMS: Readonly<Record<string, AcademyBeginnerTermCode>> = { SB: "SB", BB: "BB", BTN: "BTN", CO: "CO" };

/** Glossary codes of the seats a lesson names (only seats that have an entry). */
function seatTerms(...seats: ReadonlyArray<string | undefined>): AcademyBeginnerTermCode[] {
  return seats.flatMap((seat) => (seat && SEAT_TERMS[seat] ? [SEAT_TERMS[seat]] : []));
}

function uniqueTerms(terms: readonly AcademyBeginnerTermCode[]): AcademyBeginnerTermCode[] {
  return terms.filter((term, index) => terms.indexOf(term) === index);
}

/** " (без анте)" when the dataset's ante cannot be safely added to the pot. */
function potSuffix(pot: AcademyPreflopTablePot | undefined): string {
  return pot?.kind === "WITHOUT_ANTE" ? " (без анте)" : "";
}

function hasActionKind(view: AcademyBeginnerLessonSpotView, kind: AcademySolverPublicAction["kind"]): boolean {
  return view.actions.some((action) => action.kind === kind && action.code !== "LIMP");
}

function positionWord(hero: string, villain: string): string {
  return isInPositionPostflop(hero, villain) ? "в позиции" : "без позиции";
}

/** Facts box: the trusted chip state of the spot (absent pieces are simply not shown). */
function buildFacts(view: AcademyBeginnerLessonSpotView): AcademyBeginnerLessonFact[] {
  const { state, spot } = view;
  if (!state) return [];
  const facts: AcademyBeginnerLessonFact[] = [];
  const villain = spot.villainPosition;
  if (villain && state.villainCommittedBb !== undefined) {
    facts.push({ code: "VILLAIN_BET", label: `Ставка ${villain}`, value: bb(state.villainCommittedBb) });
  }
  if (state.heroCommittedBb > 0) facts.push({ code: "HERO_IN", label: "Ты уже поставил", value: bb(state.heroCommittedBb) });
  if (state.situation !== "RFI" && state.toCallBb > 0) facts.push({ code: "TO_CALL", label: "Доплатить для колла", value: bb(state.toCallBb) });
  const pot = potValue(spot.table?.pot);
  if (pot) facts.push({ code: "POT", ...pot });
  if (state.heroRaise) {
    const raiseOffered = view.actions.some((action) => action.kind === "RAISE" || action.kind === "ALL_IN");
    if (raiseOffered) {
      facts.push(state.heroRaise.allIn
        ? { code: "HERO_ALL_IN", label: "Олл-ин", value: bb(state.heroRaise.totalBb) }
        : { code: "HERO_RAISE", label: state.situation === "RFI" ? "Рейз до" : "3-бет до", value: bb(state.heroRaise.totalBb) });
    }
  }
  facts.push({ code: "HERO_STACK", label: "Осталось в стеке", value: bb(state.heroRemainingBb) });
  return facts;
}

function requireState(view: AcademyBeginnerLessonSpotView): AcademyPreflopHandState {
  if (!view.state) throw new Error(`Beginner lesson spot ${view.ref.stackBb}/${view.ref.nodeKey} has no documented sizing`);
  return view.state;
}

type Copy = { paragraphs: string[]; terms: AcademyBeginnerTermCode[]; compareLabel?: string };

function sbFirstInCopy(main: AcademyBeginnerLessonSpotView, hasLimp: boolean): Copy {
  const state = requireState(main);
  const raise = state.heroRaise;
  const paragraphs = [
    `Все игроки до тебя сбросили карты. Ты на малом блайнде (SB) и уже поставил обязательные ${bb(state.heroCommittedBb)}. ` +
      `Впереди остался только большой блайнд (BB) — он уже поставил ${bb(state.committedBb.BB ?? 0)}.`,
    "Малый блайнд — необычное место. Он ближе всех к баттону, но после флопа всегда ходит первым, то есть играет без позиции. " +
      "Поэтому стратегия здесь не такая, как с баттона или CO: соперник всего один, но разыгрывать банк потом неудобнее.",
  ];
  if (raise && !raise.allIn) {
    paragraphs.push(`Если открываешься, то рейзом до ${bb(raise.totalBb)}: столько ставит малый блайнд в этой стратегии на ${bb(state.stackBb)}.`);
  }
  paragraphs.push(hasLimp
    ? `Есть и третий вариант — лимп: просто доплатить ${bb(state.toCallBb)} до большого блайнда, не повышая. В этой стратегии лимп используется — смотри синие клетки в сетке.`
    : `В этой стратегии на ${bb(state.stackBb)} у малого блайнда только два действия: рейз или фолд. Просто доплатить до большого блайнда (лимп) она не предлагает.`);
  return { paragraphs, terms: hasLimp ? ["SB", "BB", "OPEN", "LIMP", "POSITION"] : ["SB", "BB", "OPEN", "POSITION"] };
}

function bbDefenceCopy(main: AcademyBeginnerLessonSpotView, compare: AcademyBeginnerLessonSpotView | undefined): Copy {
  const state = requireState(main);
  const villain = main.spot.villainPosition!;
  const pot = main.spot.table?.pot;
  const potBb = potBbOf(pot);
  const paragraphs = [
    `Ты уже поставил большой блайнд — ${bb(state.heroCommittedBb)}. ${villain} открылся рейзом до ${bb(state.villainCommittedBb!)}, остальные сбросили. ` +
      "Теперь решаем: фолд, колл или 3-бет.",
    `Чтобы сыграть колл, нужно доплатить всего ${bb(state.toCallBb)}: твой блайнд уже в банке` +
      `${potBb !== undefined ? `, а всего в банке ${bb(potBb)}${potSuffix(pot)}` : ""}. ` +
      "Дешёвый колл — главная причина, почему с большого блайнда защищают много рук.",
  ];
  if (state.heroRaise && hasActionKind(main, "RAISE")) {
    paragraphs.push(`Самые сильные руки и часть рук для давления разыгрывают 3-бетом — здесь это рейз до ${bb(state.heroRaise.totalBb)}.`);
  }
  if (compare) {
    paragraphs.push(
      `Чем раньше открылся соперник, тем сильнее его руки — и тем уже защита. Против ${villain} продолжаем со многими руками, ` +
        `против ${compare.spot.villainPosition} — заметно реже. Точные руки — в сетке ниже.`,
    );
  }
  paragraphs.push("Если до большого блайнда все сбросили, раздача просто заканчивается: открываться с BB не приходится.");
  return {
    paragraphs,
    terms: uniqueTerms([...seatTerms("BB", villain), "THREE_BET"]),
    compareLabel: compare ? `Сравни: защита против ${compare.spot.villainPosition}` : undefined,
  };
}

function sbVsOpenCopy(main: AcademyBeginnerLessonSpotView, compare: AcademyBeginnerLessonSpotView | undefined): Copy {
  const state = requireState(main);
  const villain = main.spot.villainPosition!;
  const paragraphs = [
    `${villain} открылся до ${bb(state.villainCommittedBb!)}. Ты на малом блайнде: ${bb(state.heroCommittedBb)} уже в банке, доплатить нужно ${bb(state.toCallBb)}. ` +
      "После тебя ещё ходит большой блайнд.",
    "Большой блайнд — ещё в игре. Если ты просто заколлируешь, он может повысить сам или войти в банк третьим. " +
      `А после флопа ты будешь ходить первым — ${positionWord("SB", villain)} против ${villain}.`,
  ];
  const compareState = compare?.state;
  if (compareState) {
    paragraphs.push(
      `Это не то же самое, что защита большого блайнда. У BB колл стоит ${bb(compareState.toCallBb)}, а у тебя — ${bb(state.toCallBb)}. ` +
        "К тому же за большим блайндом уже никого нет, а за тобой ещё сидит BB. Поэтому с малого блайнда сбрасывают заметно чаще, а коллируют реже.",
    );
  }
  if (state.heroRaise && hasActionKind(main, "RAISE")) {
    paragraphs.push(`Когда играешь, часто выбирают 3-бет — здесь до ${bb(state.heroRaise.totalBb)}: так меньше шансов, что BB войдёт в банк, и ты можешь забрать его сразу.`);
  }
  paragraphs.push("Решение зависит и от того, кто открылся: в тренажёре можно выбрать любую позицию соперника.");
  return {
    paragraphs,
    terms: uniqueTerms([...seatTerms("SB", "BB", villain), "THREE_BET", "POSITION"]),
    compareLabel: compare ? "Сравни: защита большого блайнда" : undefined,
  };
}

function threeBetCopy(main: AcademyBeginnerLessonSpotView, compare: AcademyBeginnerLessonSpotView | undefined): Copy {
  const state = requireState(main);
  const hero = main.spot.heroPosition;
  const villain = main.spot.villainPosition!;
  const open = state.villainCommittedBb!;
  const paragraphs = [
    "3-бет — это повторное повышение после чужого рейза. Кто-то открылся, а ты не просто коллируешь, а повышаешь ещё раз.",
    "Зачем он нужен: с сильными руками — чтобы банк стал больше (это игра на вэлью). Иногда — с руками послабее, " +
      "чтобы забрать банк сразу, если соперник сбросит (это давление).",
  ];
  if (state.heroRaise && !state.heroRaise.allIn) {
    paragraphs.push(
      `Позиция важна. ${villain} открылся до ${bb(open)}, а ты на ${hero} — после флопа будешь ходить ${isInPositionPostflop(hero, villain) ? "последним" : "первым"}, ` +
        `то есть ${positionWord(hero, villain)}. 3-бет здесь — до ${bb(state.heroRaise.totalBb)}, ${timesPhrase(state.heroRaise.totalBb / open)} больше открытия.`,
    );
  }
  const compareState = compare?.state;
  if (compare && compareState?.heroRaise && !compareState.heroRaise.allIn) {
    const cHero = compare.spot.heroPosition;
    const cVillain = compare.spot.villainPosition!;
    const cOpen = compareState.villainCommittedBb!;
    paragraphs.push(
      `${!isInPositionPostflop(cHero, cVillain) && state.heroRaise && compareState.heroRaise.totalBb > state.heroRaise.totalBb ? "Без позиции 3-бет делают крупнее" : "Для сравнения"}: с ${cHero} против открытия ${cVillain} до ${bb(cOpen)} — ` +
        `до ${bb(compareState.heroRaise.totalBb)}, ${timesPhrase(compareState.heroRaise.totalBb / cOpen)} больше открытия.`,
    );
  }
  paragraphs.push(
    `Размер всегда считаем «до»: «3-бет до ${bb(state.heroRaise?.totalBb ?? 0)}» значит, что всего перед тобой будет столько фишек, а не столько сверху.`,
  );
  return {
    paragraphs,
    terms: uniqueTerms(["THREE_BET", "POSITION", ...seatTerms(hero, villain)]),
    compareLabel: compare ? `Сравни: 3-бет с ${compare.spot.heroPosition} против ${compare.spot.villainPosition}` : undefined,
  };
}

function facingThreeBetCopy(main: AcademyBeginnerLessonSpotView): Copy {
  const state = requireState(main);
  const hero = main.spot.heroPosition;
  const villain = main.spot.villainPosition!;
  const pot = main.spot.table?.pot;
  const potBb = potBbOf(pot);
  const paragraphs = [
    `Ты открылся с ${hero} до ${bb(state.heroCommittedBb)}. ${villain} ответил 3-бетом до ${bb(state.villainCommittedBb!)}. Теперь ход снова за тобой.`,
    `Твои ${bb(state.heroCommittedBb)} уже в банке, и чтобы продолжить коллом, нужно доплатить ${bb(state.toCallBb)}` +
      `${potBb !== undefined ? ` — в банке уже ${bb(potBb)}${potSuffix(pot)}` : ""}. ` +
      `Но вложенные фишки — не повод коллировать всем подряд: соперник показал сильную руку или давит, а дальше ты будешь играть ${positionWord(hero, villain)}.`,
    `Эффективный стек здесь — ${bb(state.stackBb)}: у обоих одинаково. Сейчас у тебя в стеке ${bb(state.heroRemainingBb)}, после колла останется ${bb(state.heroRemainingBb - state.toCallBb)}.`,
  ];
  if (hasActionKind(main, "ALL_IN")) {
    paragraphs.push(
      `Ещё вариант — пойти олл-ин на все ${bb(state.stackBb)}. На такой глубине повторное повышение — это сразу весь стек, ` +
        "поэтому здесь три действия: олл-ин, колл или фолд.",
    );
  } else if (state.heroRaise && hasActionKind(main, "RAISE")) {
    paragraphs.push(`Ещё вариант — снова повысить, до ${bb(state.heroRaise.totalBb)}. Здесь три действия: рейз, колл или фолд.`);
  } else {
    paragraphs.push("Повышать здесь стратегия не предлагает: только колл или фолд.");
  }
  return {
    paragraphs,
    terms: uniqueTerms([...seatTerms(hero, villain), "THREE_BET", "EFFECTIVE_STACK", ...(hasActionKind(main, "ALL_IN") ? ["ALL_IN" as const] : [])]),
  };
}

const viewCache = new Map<string, AcademyBeginnerLessonView>();

/** Lesson view for a slug, or null for an unknown slug. Throws if a bound spot is not a real node (fail closed). */
export function getBeginnerAfterOpenLessonView(slug: string): AcademyBeginnerLessonView | null {
  const lesson = getBeginnerAfterOpenLesson(slug);
  if (!lesson) return null;
  const cached = viewCache.get(lesson.slug);
  if (cached) return cached;

  const main = resolveSpot(lesson.spot);
  const compare = lesson.compareSpot ? resolveSpot(lesson.compareSpot) : undefined;
  const hasLimp = main.actions.some((action) => action.code === "LIMP");

  let copy: Copy;
  switch (lesson.slug) {
    case "sb-first-in": copy = sbFirstInCopy(main, hasLimp); break;
    case "bb-defence": copy = bbDefenceCopy(main, compare); break;
    case "sb-vs-open": copy = sbVsOpenCopy(main, compare); break;
    case "three-bet": copy = threeBetCopy(main, compare); break;
    case "facing-three-bet": copy = facingThreeBetCopy(main); break;
  }

  const next = ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.find((candidate) => candidate.order === lesson.order + 1);
  const view: AcademyBeginnerLessonView = Object.freeze({
    lesson,
    main,
    ...(compare && copy.compareLabel ? { compare: Object.freeze({ ...compare, linkLabel: copy.compareLabel }) } : {}),
    paragraphs: Object.freeze(copy.paragraphs),
    facts: Object.freeze(buildFacts(main)),
    terms: Object.freeze(copy.terms),
    hasLimp,
    ...(next ? { next } : {}),
  });
  viewCache.set(lesson.slug, view);
  return view;
}

export function listBeginnerAfterOpenLessonViews(): readonly AcademyBeginnerLessonView[] {
  return ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.map((lesson) => getBeginnerAfterOpenLessonView(lesson.slug)!);
}
