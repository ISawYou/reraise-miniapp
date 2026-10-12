/**
 * Typed, machine-readable preflop sizing profiles — an ADDITIVE companion to
 * the descriptive sizing strings already recorded in each dataset's
 * `assumptions` (openSizing / threeBetSizing / … in
 * config/academy/mtt-reference-datasets.ts, `openSizeBb` in
 * config/academy/preflop-ranges.ts). Those strings stay the human provenance
 * record and are never parsed at runtime; these profiles encode the same
 * documented numbers as data. `config/academy/mtt-reference-datasets.ts`
 * cross-checks them against its own all-in table at load.
 *
 * Every size is a TOTAL bet ("raise to"). A level absent from `levels` is not
 * documented by the source and is never sized (generic label instead).
 *
 * Dependency-light on purpose (no dataset payloads): only the HRC range
 * config is read, to REUSE its stored `openSizeBb` instead of duplicating it.
 */
import { getAcademyPreflopRange } from "@/config/academy/preflop-ranges";
import {
  ACADEMY_EXTERNAL_MTT_PREFLOP_100BB_DATASET_ID,
  ACADEMY_EXTERNAL_MTT_PREFLOP_10BB_DATASET_ID,
  ACADEMY_EXTERNAL_MTT_PREFLOP_20BB_DATASET_ID,
  ACADEMY_EXTERNAL_MTT_PREFLOP_40BB_DATASET_ID,
  ACADEMY_EXTERNAL_MTT_PREFLOP_5BB_DATASET_ID,
  ACADEMY_HRC_SCENARIO_B_RFI_100BB_DATASET_ID,
} from "@/config/academy/solver-dataset-ids";
import type { AcademyPreflopSizingProfile } from "@/lib/academy/preflop-sizing";

const ALL_IN = Object.freeze({ kind: "ALL_IN" } as const);

/**
 * MTT reference sets (upstream README "Bet sizing profiles"):
 * - 5 BB:   open = all-in 5;  later raises = all-in.
 * - 10 BB:  open = all-in 10; later raises = all-in.
 * - 20 BB:  open 2 (SB 3); 3-bet = all-in; later raises = all-in.
 * - 40 BB:  open 2.3 (SB 3.5); 3-bet 3× IP / 4× OOP of the open, max 9 IP / 10 OOP; 4-bet = all-in (5-bet all-in).
 * - 100 BB: open 2.3 (SB 4); 3-bet 3.5× IP / 4.5× OOP of the open; 4-bet 2.2× IP / 2.5× OOP of the 3-bet; 5-bet = all-in.
 */
export const ACADEMY_MTT_REFERENCE_SIZING_PROFILES: Readonly<Record<5 | 10 | 20 | 40 | 100, AcademyPreflopSizingProfile>> =
  Object.freeze({
    5: Object.freeze({ stackBb: 5, levels: Object.freeze({ OPEN: ALL_IN, THREE_BET: ALL_IN, FOUR_BET: ALL_IN, FIVE_BET: ALL_IN }) }),
    10: Object.freeze({ stackBb: 10, levels: Object.freeze({ OPEN: ALL_IN, THREE_BET: ALL_IN, FOUR_BET: ALL_IN, FIVE_BET: ALL_IN }) }),
    20: Object.freeze({
      stackBb: 20,
      levels: Object.freeze({
        OPEN: Object.freeze({ kind: "FIXED_OPEN", openBb: 2, sbOpenBb: 3 }),
        THREE_BET: ALL_IN,
        FOUR_BET: ALL_IN,
        FIVE_BET: ALL_IN,
      }),
    }),
    40: Object.freeze({
      stackBb: 40,
      levels: Object.freeze({
        OPEN: Object.freeze({ kind: "FIXED_OPEN", openBb: 2.3, sbOpenBb: 3.5 }),
        THREE_BET: Object.freeze({ kind: "MULTIPLIER", ipMultiplier: 3, oopMultiplier: 4, maxIpBb: 9, maxOopBb: 10 }),
        FOUR_BET: ALL_IN,
        FIVE_BET: ALL_IN,
      }),
    }),
    100: Object.freeze({
      stackBb: 100,
      levels: Object.freeze({
        OPEN: Object.freeze({ kind: "FIXED_OPEN", openBb: 2.3, sbOpenBb: 4 }),
        THREE_BET: Object.freeze({ kind: "MULTIPLIER", ipMultiplier: 3.5, oopMultiplier: 4.5 }),
        FOUR_BET: Object.freeze({ kind: "MULTIPLIER", ipMultiplier: 2.2, oopMultiplier: 2.5 }),
        FIVE_BET: ALL_IN,
      }),
    }),
  });

/**
 * HRC Scenario B 100 BB RFI: only the open size is documented
 * (`assumptions.openSizeBb`, read from the stored range — not a second copy).
 * No SB node and no SB size, no 3-bet+ levels.
 */
export const ACADEMY_HRC_RFI_100BB_SIZING_PROFILE: AcademyPreflopSizingProfile = Object.freeze({
  stackBb: getAcademyPreflopRange("UTG").effectiveStackBb,
  levels: Object.freeze({
    OPEN: Object.freeze({ kind: "FIXED_OPEN", openBb: getAcademyPreflopRange("UTG").assumptions.openSizeBb }),
  }),
});

const PROFILES_BY_DATASET: Readonly<Record<string, AcademyPreflopSizingProfile>> = Object.freeze({
  [ACADEMY_EXTERNAL_MTT_PREFLOP_5BB_DATASET_ID]: ACADEMY_MTT_REFERENCE_SIZING_PROFILES[5],
  [ACADEMY_EXTERNAL_MTT_PREFLOP_10BB_DATASET_ID]: ACADEMY_MTT_REFERENCE_SIZING_PROFILES[10],
  [ACADEMY_EXTERNAL_MTT_PREFLOP_20BB_DATASET_ID]: ACADEMY_MTT_REFERENCE_SIZING_PROFILES[20],
  [ACADEMY_EXTERNAL_MTT_PREFLOP_40BB_DATASET_ID]: ACADEMY_MTT_REFERENCE_SIZING_PROFILES[40],
  [ACADEMY_EXTERNAL_MTT_PREFLOP_100BB_DATASET_ID]: ACADEMY_MTT_REFERENCE_SIZING_PROFILES[100],
  [ACADEMY_HRC_SCENARIO_B_RFI_100BB_DATASET_ID]: ACADEMY_HRC_RFI_100BB_SIZING_PROFILE,
});

/** Sizing profile of a dataset, or undefined when the source documents none (→ unsized labels). */
export function getAcademyPreflopSizingProfile(datasetId: string): AcademyPreflopSizingProfile | undefined {
  return Object.prototype.hasOwnProperty.call(PROFILES_BY_DATASET, datasetId) ? PROFILES_BY_DATASET[datasetId] : undefined;
}
