/**
 * Preflop sizing / stack / pot model (client-safe, pure). PRESENTATION ONLY:
 * nothing here touches strategy frequencies, action codes or scoring.
 *
 * Inputs are typed, machine-readable sizing profiles
 * (config/academy/preflop-sizing-profiles.ts) that mirror ONLY what a source
 * documents. A level the source does not document is simply absent from the
 * profile, and every function here then returns `null` / `undefined` — the UI
 * falls back to its generic, unsized label. Sizes are never guessed.
 *
 * Conventions
 * - Every size is the TOTAL bet in front of the player after the action
 *   ("рейз до 9.2 BB"), never the chips added on top of the previous bet.
 * - Every seat starts with the dataset's effective stack (`stackBb`); a
 *   different REMAINING stack only ever comes from chips committed earlier in
 *   the same hand (starting − committed). Antes are not part of committed
 *   chips or stacks; they are dead money handled by the pot policy below.
 * - Math is exact: amounts are integer micro-BB units and multipliers are
 *   integer hundredths, so 2.3 × 3.5 is exactly 8.05 (not 8.049999…). The only
 *   rounding happens in `formatSizingBb`, at display time.
 * - IP/OOP: postflop acting order, derived from the platform's own preflop
 *   seat order (`ACADEMY_PREFLOP_TRAINER_SEAT_ORDER`, UTG … BB) by moving the
 *   two blinds to the front (SB and BB act first postflop, BTN last).
 */
import { ACADEMY_PREFLOP_TRAINER_SEAT_ORDER } from "@/lib/academy/preflop-trainer-selection";
import type {
  AcademyActionSizing,
  AcademyPreflopTableMoney,
  AcademyPreflopTableMoneySeat,
  AcademyPreflopTablePot,
  AcademyPreflopTrainerSituation,
  AcademyStrategyActionKind,
  AcademyStrategyAssumptions,
} from "@/types/academy";

// ---------------------------------------------------------------------------
// Exact arithmetic
// ---------------------------------------------------------------------------

/** Internal precision: 1 BB = 1 000 000 integer units. */
export const ACADEMY_SIZING_UNITS_PER_BB = 1_000_000;

/** Exact conversion of a documented constant (fails loudly if it is finer than 1e-6 BB). */
function exactUnits(bb: number): number {
  const units = Math.round(bb * ACADEMY_SIZING_UNITS_PER_BB);
  if (!Number.isFinite(bb) || Math.abs(units - bb * ACADEMY_SIZING_UNITS_PER_BB) > 1e-3) {
    throw new Error(`Sizing value ${bb} BB is not representable exactly`);
  }
  return units;
}

/** Snap a transported BB number (itself produced from units) back onto the exact grid. */
function snapUnits(bb: number): number {
  return Math.round(bb * ACADEMY_SIZING_UNITS_PER_BB);
}

function toBb(units: number): number {
  return units / ACADEMY_SIZING_UNITS_PER_BB;
}

/** units × multiplier, exact: the multiplier is taken as integer hundredths. */
function multiplyUnits(units: number, multiplier: number): number {
  const hundredths = Math.round(multiplier * 100);
  if (Math.abs(hundredths - multiplier * 100) > 1e-9) throw new Error(`Multiplier ${multiplier} has more than 2 decimals`);
  const product = units * hundredths;
  if (product % 100 !== 0) throw new Error(`Sizing product ${units} × ${multiplier} is not exact`);
  return product / 100;
}

/**
 * Display rule — the ONLY rounding step of the model:
 * - the value is snapped to exact micro-BB units, then rounded half-up;
 * - below 10 BB: at most 2 decimals (2.25, 2.3, 8.05, 9.2);
 * - 10 BB and above: at most 1 decimal (10.4, 17.7, 20.1);
 * - trailing zeros are trimmed (2.00 → "2", 6.90 → "6.9", 20.0 → "20").
 */
export function formatSizingBb(value: number): string {
  const units = snapUnits(value);
  if (units < 0) return `-${formatSizingBb(-value)}`;
  const decimals = units < 10 * ACADEMY_SIZING_UNITS_PER_BB ? 2 : 1;
  const step = ACADEMY_SIZING_UNITS_PER_BB / 10 ** decimals;
  const rounded = Math.floor((units + step / 2) / step);
  const scale = 10 ** decimals;
  const whole = Math.floor(rounded / scale);
  const fraction = String(rounded % scale).padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** "2.3 BB" (see `formatSizingBb`). */
export function formatSizingBbLabel(value: number): string {
  return `${formatSizingBb(value)} BB`;
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/** Aggressive action level of a preflop decision. */
export type AcademyPreflopSizingLevel = "OPEN" | "THREE_BET" | "FOUR_BET" | "FIVE_BET";

/**
 * One documented sizing rule (TOTAL bet sizes):
 * - `ALL_IN`: the whole starting stack;
 * - `FIXED_OPEN`: open-raise to `openBb` (IP / non-SB seats) or `sbOpenBb`
 *   (SB; absent when the source does not document an SB size);
 * - `MULTIPLIER`: `ip`/`oop` × the previous (aggressor's) total bet, capped at
 *   `maxIpBb` / `maxOopBb` when the source documents a cap.
 */
export type AcademyPreflopRaiseRule =
  | { readonly kind: "ALL_IN" }
  | { readonly kind: "FIXED_OPEN"; readonly openBb: number; readonly sbOpenBb?: number }
  | {
    readonly kind: "MULTIPLIER";
    readonly ipMultiplier: number;
    readonly oopMultiplier: number;
    readonly maxIpBb?: number;
    readonly maxOopBb?: number;
  };

/**
 * Typed sizing profile of one source / stack. A level missing from `levels`
 * is NOT documented by the source: nothing at that level is ever sized.
 */
export type AcademyPreflopSizingProfile = {
  readonly stackBb: number;
  readonly levels: Readonly<Partial<Record<AcademyPreflopSizingLevel, AcademyPreflopRaiseRule>>>;
};

/** Which aggressive level the hero's raise is at in each situation (none facing a 5-bet). */
export const ACADEMY_PREFLOP_HERO_RAISE_LEVEL: Readonly<Record<AcademyPreflopTrainerSituation, AcademyPreflopSizingLevel | null>> =
  Object.freeze({
    RFI: "OPEN",
    FACING_OPEN: "THREE_BET",
    FACING_3BET: "FOUR_BET",
    FACING_4BET: "FIVE_BET",
    FACING_5BET: null,
  });

/** The heads-up action line every trainer node implies before the hero's decision. */
const PRIOR_STEPS: Readonly<Record<AcademyPreflopTrainerSituation, ReadonlyArray<readonly ["HERO" | "VILLAIN", AcademyPreflopSizingLevel]>>> = {
  RFI: [],
  FACING_OPEN: [["VILLAIN", "OPEN"]],
  FACING_3BET: [["HERO", "OPEN"], ["VILLAIN", "THREE_BET"]],
  FACING_4BET: [["VILLAIN", "OPEN"], ["HERO", "THREE_BET"], ["VILLAIN", "FOUR_BET"]],
  FACING_5BET: [["HERO", "OPEN"], ["VILLAIN", "THREE_BET"], ["HERO", "FOUR_BET"], ["VILLAIN", "FIVE_BET"]],
};

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------

function preflopSeatIndex(seat: string): number {
  const index = (ACADEMY_PREFLOP_TRAINER_SEAT_ORDER as readonly string[]).indexOf(seat);
  if (index === -1) throw new Error(`Unknown table seat: ${seat}`);
  return index;
}

/** Postflop acting rank (0 = acts first): SB 0, BB 1, UTG 2, …, BTN 8. */
export function postflopActingRank(seat: string): number {
  return (preflopSeatIndex(seat) + 2) % ACADEMY_PREFLOP_TRAINER_SEAT_ORDER.length;
}

/** True iff `seat` acts after `opponent` postflop (is in position on them). */
export function isInPositionPostflop(seat: string, opponent: string): boolean {
  return postflopActingRank(seat) > postflopActingRank(opponent);
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

function raiseToUnits(
  rule: AcademyPreflopRaiseRule,
  seat: string,
  opponent: string | undefined,
  previousTotalUnits: number,
  stackUnits: number,
): number | null {
  switch (rule.kind) {
    case "ALL_IN":
      return stackUnits;
    case "FIXED_OPEN": {
      const bb = seat === "SB" ? rule.sbOpenBb : rule.openBb;
      return bb === undefined ? null : Math.min(exactUnits(bb), stackUnits);
    }
    case "MULTIPLIER": {
      if (!opponent) return null;
      const inPosition = isInPositionPostflop(seat, opponent);
      let total = multiplyUnits(previousTotalUnits, inPosition ? rule.ipMultiplier : rule.oopMultiplier);
      const cap = inPosition ? rule.maxIpBb : rule.maxOopBb;
      if (cap !== undefined) total = Math.min(total, exactUnits(cap));
      return Math.min(total, stackUnits);
    }
  }
}

/**
 * Raise-to size of one documented rule (TOTAL bet), or null when the rule
 * does not document a size for this seat. Exposed for focused tests.
 */
export function resolveRaiseToBb({
  rule,
  seat,
  opponent,
  previousTotalBb,
  stackBb,
}: {
  readonly rule: AcademyPreflopRaiseRule;
  readonly seat: string;
  readonly opponent?: string;
  readonly previousTotalBb: number;
  readonly stackBb: number;
}): number | null {
  const units = raiseToUnits(rule, seat, opponent, exactUnits(previousTotalBb), exactUnits(stackBb));
  return units === null ? null : toBb(units);
}

export type AcademyPreflopSizingStep = {
  readonly actor: "HERO" | "VILLAIN";
  readonly seat: string;
  readonly level: AcademyPreflopSizingLevel;
  /** Total bet after this action. */
  readonly totalBb: number;
  readonly allIn: boolean;
};

/** Full chip state of a heads-up preflop node just before the hero acts. */
export type AcademyPreflopHandState = {
  readonly stackBb: number;
  readonly situation: AcademyPreflopTrainerSituation;
  readonly heroSeat: string;
  readonly villainSeat?: string;
  /** Earlier aggressive actions with their documented sizes, in order. */
  readonly steps: readonly AcademyPreflopSizingStep[];
  /** Chips committed this hand per seat (blinds included, antes excluded); seats with 0 omitted. */
  readonly committedBb: Readonly<Record<string, number>>;
  /** Largest total bet so far. */
  readonly currentBetBb: number;
  readonly heroCommittedBb: number;
  readonly heroRemainingBb: number;
  readonly villainCommittedBb?: number;
  readonly villainRemainingBb?: number;
  /** Chips the hero needs to call the current bet (0 if nothing to call). */
  readonly toCallBb: number;
  /** The hero's own raise size at this node, when documented and possible. */
  readonly heroRaise?: { readonly totalBb: number; readonly allIn: boolean };
};

/**
 * Derives the chip state of a node from the documented profile. Returns null
 * (= show nothing sized) whenever ANY earlier action lacks a documented size,
 * or the profile's stack differs from the dataset's effective stack.
 */
export function resolvePreflopHandState({
  profile,
  stackBb,
  situation,
  heroSeat,
  villainSeat,
}: {
  readonly profile: AcademyPreflopSizingProfile | undefined;
  readonly stackBb: number;
  readonly situation: AcademyPreflopTrainerSituation;
  readonly heroSeat: string;
  readonly villainSeat?: string;
}): AcademyPreflopHandState | null {
  if (!profile || profile.stackBb !== stackBb) return null;
  if ((situation === "RFI") !== (villainSeat === undefined)) return null;
  const stackUnits = exactUnits(stackBb);
  const committed = new Map<string, number>([["SB", exactUnits(0.5)], ["BB", exactUnits(1)]]);
  let currentBet = exactUnits(1);
  const steps: AcademyPreflopSizingStep[] = [];

  for (const [actor, level] of PRIOR_STEPS[situation]) {
    const rule = profile.levels[level];
    const seat = actor === "HERO" ? heroSeat : villainSeat!;
    const opponent = actor === "HERO" ? villainSeat : heroSeat;
    if (!rule) return null;
    const total = raiseToUnits(rule, seat, opponent, currentBet, stackUnits);
    if (total === null || total <= currentBet) return null;
    committed.set(seat, total);
    currentBet = total;
    steps.push(Object.freeze({ actor, seat, level, totalBb: toBb(total), allIn: total >= stackUnits }));
  }

  const heroCommitted = committed.get(heroSeat) ?? 0;
  const villainCommitted = villainSeat ? committed.get(villainSeat) ?? 0 : undefined;
  const toCall = Math.max(0, Math.min(currentBet, stackUnits) - heroCommitted);

  let heroRaise: AcademyPreflopHandState["heroRaise"];
  const heroLevel = ACADEMY_PREFLOP_HERO_RAISE_LEVEL[situation];
  const heroRule = heroLevel ? profile.levels[heroLevel] : undefined;
  // No raise once the villain is all-in: the hero can only call or fold.
  if (heroRule && currentBet < stackUnits) {
    const total = raiseToUnits(heroRule, heroSeat, villainSeat, currentBet, stackUnits);
    if (total !== null && total > currentBet) heroRaise = Object.freeze({ totalBb: toBb(total), allIn: total >= stackUnits });
  }

  return Object.freeze({
    stackBb,
    situation,
    heroSeat,
    ...(villainSeat ? { villainSeat } : {}),
    steps: Object.freeze(steps),
    committedBb: Object.freeze(Object.fromEntries([...committed].filter(([, units]) => units > 0).map(([seat, units]) => [seat, toBb(units)]))),
    currentBetBb: toBb(currentBet),
    heroCommittedBb: toBb(heroCommitted),
    heroRemainingBb: toBb(stackUnits - heroCommitted),
    ...(villainSeat ? { villainCommittedBb: toBb(villainCommitted!), villainRemainingBb: toBb(stackUnits - villainCommitted!) } : {}),
    toCallBb: toBb(toCall),
    ...(heroRaise ? { heroRaise } : {}),
  });
}

// ---------------------------------------------------------------------------
// Action sizing (button labels)
// ---------------------------------------------------------------------------

/**
 * Trusted sizing of one node action, or undefined (→ generic label):
 * - RAISE / BET: the hero's documented raise-to size ("3-бет до 9.2 BB"); when
 *   the documented size reaches the stack it is labelled as the all-in it is;
 * - ALL_IN: the full starting stack ("Олл-ин 20 BB"), unless the villain is
 *   already all-in (then it is not a raise at all);
 * - CALL facing a raise: the chips still needed ("Колл 18 BB");
 * - LIMP, FOLD, CHECK and anything undocumented: undefined.
 * `genericButton` is the action's existing unsized label ("Рейз", "3-бет" …).
 */
export function sizePreflopAction(
  action: { readonly code: string; readonly kind: AcademyStrategyActionKind },
  genericButton: string,
  state: AcademyPreflopHandState | null,
): AcademyActionSizing | undefined {
  if (!state) return undefined;
  const stackUnits = exactUnits(state.stackBb);
  switch (action.kind) {
    case "RAISE":
    case "BET": {
      if (!state.heroRaise) return undefined;
      const { totalBb, allIn } = state.heroRaise;
      return allIn
        ? Object.freeze({ kind: "ALL_IN", totalBb, button: `Олл-ин ${formatSizingBbLabel(totalBb)}` })
        : Object.freeze({ kind: "RAISE_TO", totalBb, button: `${genericButton} до ${formatSizingBbLabel(totalBb)}` });
    }
    case "ALL_IN":
      if (snapUnits(state.currentBetBb) >= stackUnits) return undefined;
      return Object.freeze({ kind: "ALL_IN", totalBb: state.stackBb, button: `Олл-ин ${formatSizingBbLabel(state.stackBb)}` });
    case "CALL": {
      if (action.code === "LIMP" || state.situation === "RFI" || state.toCallBb <= 0) return undefined;
      return Object.freeze({
        kind: "CALL",
        totalBb: toBb(snapUnits(state.heroCommittedBb) + snapUnits(state.toCallBb)),
        toCallBb: state.toCallBb,
        button: `Колл ${formatSizingBbLabel(state.toCallBb)}`,
      });
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Ante policy + pot
// ---------------------------------------------------------------------------

/**
 * What a dataset's assumptions say about the ante:
 * - `NONE`: explicitly no ante;
 * - `PER_PLAYER`: explicit per-player ante (and, if stated, a consistent total);
 * - `AMBIGUOUS`: an ante exists (or is not documented at all) but it is not
 *   stated whether the value is per player, a total, or a big-blind ante.
 */
export type AcademyAnteSemantics =
  | { readonly kind: "NONE" }
  | { readonly kind: "PER_PLAYER"; readonly perPlayerBb: number; readonly totalBb: number }
  | { readonly kind: "AMBIGUOUS"; readonly declaredBb?: number };

/**
 * Fail-conservative reading of the ante: only an explicit `antePerPlayerBb`
 * (whose `anteTotalBb`, if present, must equal per-player × table size) is
 * trusted. A bare `anteBb` (e.g. the MTT reference sets' "1 BB ante", which
 * never says per player vs total) is AMBIGUOUS.
 */
export function resolveAnteSemantics(assumptions: AcademyStrategyAssumptions, tableSize: number): AcademyAnteSemantics {
  const perPlayer = assumptions.antePerPlayerBb;
  const total = assumptions.anteTotalBb;
  if (typeof perPlayer === "number" && Number.isFinite(perPlayer) && perPlayer >= 0) {
    const expectedTotal = snapUnits(perPlayer) * tableSize;
    if (total !== undefined && (typeof total !== "number" || snapUnits(total) !== expectedTotal)) {
      return Object.freeze({ kind: "AMBIGUOUS", declaredBb: perPlayer });
    }
    return perPlayer === 0
      ? Object.freeze({ kind: "NONE" })
      : Object.freeze({ kind: "PER_PLAYER", perPlayerBb: perPlayer, totalBb: toBb(expectedTotal) });
  }
  const declared = assumptions.anteBb;
  if (declared === 0) return Object.freeze({ kind: "NONE" });
  return Object.freeze(typeof declared === "number" && Number.isFinite(declared)
    ? { kind: "AMBIGUOUS", declaredBb: declared }
    : { kind: "AMBIGUOUS" });
}

/** Separate ante note shown instead of folding an ambiguous ante into the pot. */
export function anteNote(ante: Extract<AcademyAnteSemantics, { kind: "AMBIGUOUS" }>): string {
  return ante.declaredBb === undefined
    ? "Анте · источник не уточняет"
    : `Анте ${formatSizingBbLabel(ante.declaredBb)} · формат не указан`;
}

/** Pot from trusted contributions only (see `AcademyPreflopTablePot`). */
export function buildPreflopTablePot(knownBb: number, ante: AcademyAnteSemantics): AcademyPreflopTablePot {
  switch (ante.kind) {
    case "NONE":
      return Object.freeze({ kind: "EXACT", totalBb: knownBb, anteTotalBb: 0 });
    case "PER_PLAYER":
      return Object.freeze({ kind: "EXACT", totalBb: toBb(snapUnits(knownBb) + snapUnits(ante.totalBb)), anteTotalBb: ante.totalBb });
    case "AMBIGUOUS":
      return Object.freeze({ kind: "WITHOUT_ANTE", knownBb, anteNote: anteNote(ante) });
  }
}

/**
 * Table money model: hero + active villain with starting/committed/remaining,
 * forced blinds of the other seats (dead money stays in the pot), the pot and
 * the hero's call amount.
 */
export function buildPreflopTableMoney(state: AcademyPreflopHandState, ante: AcademyAnteSemantics): AcademyPreflopTableMoney {
  const stackUnits = exactUnits(state.stackBb);
  const seats: AcademyPreflopTableMoneySeat[] = [];
  let knownUnits = 0;
  for (const seat of ACADEMY_PREFLOP_TRAINER_SEAT_ORDER) {
    const committedUnits = snapUnits(state.committedBb[seat] ?? 0);
    knownUnits += committedUnits;
    const active = seat === state.heroSeat || seat === state.villainSeat;
    if (committedUnits === 0 && !active) continue;
    seats.push(Object.freeze({
      seat,
      committedBb: toBb(committedUnits),
      ...(seat === "SB" || seat === "BB" ? { blind: seat } : {}),
      allIn: committedUnits >= stackUnits,
      ...(active ? { remainingBb: toBb(stackUnits - committedUnits) } : {}),
    }));
  }
  return Object.freeze({
    startingStackBb: state.stackBb,
    seats: Object.freeze(seats),
    pot: buildPreflopTablePot(toBb(knownUnits), ante),
    ...(state.situation !== "RFI" && state.toCallBb > 0 ? { toCallBb: state.toCallBb } : {}),
  });
}

/**
 * The hero's all-in, applied after the hero chose an all-in action (reveal):
 * committed = starting stack, remaining = 0, the pot grows by the extra chips,
 * nothing is left to call. Returns the input unchanged if the hero is absent
 * or already all-in.
 */
export function withHeroAllIn(money: AcademyPreflopTableMoney, heroSeat: string): AcademyPreflopTableMoney {
  const hero = money.seats.find((seat) => seat.seat === heroSeat);
  if (!hero || hero.allIn) return money;
  const deltaUnits = snapUnits(money.startingStackBb) - snapUnits(hero.committedBb);
  const pot: AcademyPreflopTablePot = money.pot.kind === "EXACT"
    ? { ...money.pot, totalBb: toBb(snapUnits(money.pot.totalBb) + deltaUnits) }
    : { ...money.pot, knownBb: toBb(snapUnits(money.pot.knownBb) + deltaUnits) };
  return Object.freeze({
    startingStackBb: money.startingStackBb,
    seats: Object.freeze(money.seats.map((seat) => (seat.seat === heroSeat
      ? Object.freeze({ ...seat, committedBb: money.startingStackBb, allIn: true, remainingBb: 0 })
      : seat))),
    pot: Object.freeze(pot),
    // Presentation-only ante label travels unchanged (never part of the math).
    ...(money.ante ? { ante: money.ante } : {}),
  });
}
