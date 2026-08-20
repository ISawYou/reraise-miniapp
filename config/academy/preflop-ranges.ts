import {
  ACADEMY_PREFLOP_POSITIONS,
  parseHrcRangeNotation,
  validateAcademyPreflopRange,
} from "@/lib/academy/preflop";
import type { AcademyPreflopRange, PreflopPosition } from "@/types/academy";

const HRC_RANGE_URL = "https://www.holdemresources.net/blog/card-bunching-effects/ScenarioB/100bb-ranges.txt";
const HRC_CONTEXT_URL = "https://www.holdemresources.net/blog/card-bunching-effects/";

const PROVENANCE_NOTE =
  "Public HRC Scenario B frequencies are preserved as the reference strategy. " +
  "HRC describes these ranges as an approximation of general 100 BB opening-range composition, " +
  "not definitive GTO ranges. RERAISE Academy derives a binary teaching strategy from them.";

type HrcSourceRange = {
  sourcePosition: AcademyPreflopRange["source"]["sourcePosition"];
  reportedWeightedRangePercentage: number;
  notation: string;
};

// Verbatim strategy notation from the public HRC 100 BB Scenario B export.
// BU is normalized to BTN in the Academy domain model.
const HRC_SOURCE_RANGES = {
  UTG: {
    sourcePosition: "UTG",
    reportedWeightedRangePercentage: 14.2,
    notation: "55+, 44:0.61, A3s+, AQo+, AJo:0.41, K9s+, K8s:0.01, KQo:0.87, QTs+, J9s+, T9s, T8s:0.32, 65s:0.70, 54s:0.26",
  },
  EP: {
    sourcePosition: "EP",
    reportedWeightedRangePercentage: 15.9,
    notation: "44+, 33:0.03, A3s+, AQo+, AJo:0.99, ATo:0.16, K8s+, K7s:0.17, KQo, KJo:0.11, QTs+, Q9s:0.09, J9s+, T8s+, 76s:0.05, 65s:0.90, 54s:0.20",
  },
  MP1: {
    sourcePosition: "MP1",
    reportedWeightedRangePercentage: 18.7,
    notation: "44+, 33:0.94, A2s+, AJo+, ATo:0.88, K7s+, KQo, KJo:0.61, Q9s+, QJo:0.01, J9s+, JTo:0.15, T8s+, 98s:0.59, 76s:0.30, 65s:0.82, 54s:0.39",
  },
  MP2: {
    sourcePosition: "MP2",
    reportedWeightedRangePercentage: 22.1,
    notation: "33+, 22:0.88, A2s+, ATo+, K5s+, KJo+, KTo:0.43, Q9s+, QJo:0.57, J9s+, J8s:0.61, JTo:0.46, T8s+, 98s, 87s:0.58, 76s:0.64, 65s, 54s:0.69",
  },
  HJ: {
    sourcePosition: "HJ",
    reportedWeightedRangePercentage: 27.4,
    notation: "22+, A2s+, A9o+, A8o:0.15, K4s+, K3s:0.44, KTo+, Q8s+, QJo, QTo:0.88, J8s+, JTo, T7s+, 97s+, 87s, 86s:0.38, 76s, 75s:0.32, 65s, 54s",
  },
  CO: {
    sourcePosition: "CO",
    reportedWeightedRangePercentage: 35.6,
    notation: "22+, A2s+, A7o+, A5o, K2s+, K9o+, Q4s+, QTo+, Q9o:0.16, J7s+, J6s:0.51, J5s:0.74, JTo, T7s+, T9o:0.95, 96s+, 86s+, 75s+, 64s+, 54s, 53s:0.95",
  },
  BTN: {
    sourcePosition: "BU",
    reportedWeightedRangePercentage: 54.8,
    notation: "22+, A2s+, A2o+, K2s+, K5o+, Q2s+, Q8o+, Q7o:0.98, J2s+, J8o+, T3s+, T8o+, T7o:0.59, 95s+, 98o, 97o:0.01, 85s+, 87o, 74s+, 64s+, 63s:0.57, 53s+, 43s",
  },
} as const satisfies Record<PreflopPosition, HrcSourceRange>;

function createRange(position: PreflopPosition): AcademyPreflopRange {
  const sourceRange = HRC_SOURCE_RANGES[position];
  const range: AcademyPreflopRange = {
    code: `rfi_9max_100bb_${position.toLowerCase()}` as AcademyPreflopRange["code"],
    game: "NLHE",
    format: "MTT",
    tableSize: 9,
    effectiveStackBb: 100,
    spot: "RFI",
    position,
    assumptions: Object.freeze({
      model: "CHIP_EV",
      approximate: true,
      antePerPlayerBb: 0.1,
      anteTotalBb: 0.9,
      openSizeBb: 2.25,
      rake: "RAKELESS",
    }),
    source: Object.freeze({
      provider: "HRC",
      scenario: "Scenario B: 100bb deepstacked",
      sourcePosition: sourceRange.sourcePosition,
      rangeUrl: HRC_RANGE_URL,
      contextUrl: HRC_CONTEXT_URL,
      reportedWeightedRangePercentage: sourceRange.reportedWeightedRangePercentage,
      provenanceNote: PROVENANCE_NOTE,
    }),
    referenceStrategy: parseHrcRangeNotation(sourceRange.notation),
  };

  validateAcademyPreflopRange(range);
  return Object.freeze(range);
}

export const ACADEMY_PREFLOP_RANGES = Object.freeze(Object.fromEntries(
  ACADEMY_PREFLOP_POSITIONS.map((position) => [position, createRange(position)]),
) as Record<PreflopPosition, AcademyPreflopRange>);

export function getAcademyPreflopRange(position: PreflopPosition): AcademyPreflopRange {
  return ACADEMY_PREFLOP_RANGES[position];
}
