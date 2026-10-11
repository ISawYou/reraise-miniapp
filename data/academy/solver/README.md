# RERAISE normalized solver dataset format (schema v1)

This directory defines the **RERAISE-owned interchange format** for importing
solver strategy datasets into Academy (Solver Lab) in the future. It is
deliberately independent of any solver tool's native export format.

- Types + fail-closed validator: [`schema-v1.ts`](./schema-v1.ts)
- Runtime model it converts into: `AcademyStrategyDataset` in `types/academy.ts`
- Production registry: `ACADEMY_STRATEGY_DATASETS` in
  `config/academy/solver-datasets.ts`

## Status

- **No dataset in this format is used in production yet.** The only
  production dataset, `hrc_scenario_b_rfi_9max_100bb_v1`, is built by a
  compatibility adapter over `config/academy/preflop-ranges.ts`.
- **No real HRC export fixture exists in this repository.** An HRC-specific
  adapter must **not** be written until a real export file is provided; HRC's
  native JSON schema must not be guessed. `importHrcSolverExport()` in
  `schema-v1.ts` is an explicit, unimplemented boundary that throws.
- No 30 BB / multi-action dataset exists yet. Do not add placeholder or
  invented strategies to the registry.

## Shape

```ts
{
  schemaVersion: 1,
  dataset: {
    id: string,            // immutable version id, unique within the registry
    version: number,       // positive integer
    title: string,
    metadata: {            // open string/number codes, not enums
      game: string,              // e.g. "NLHE"
      format: string,            // e.g. "MTT"
      strategyModel: string,     // e.g. "CHIP_EV"
      tableSize: number,         // integer >= 2
      effectiveStackBb: number,  // > 0
      spotCode: string,          // e.g. "RFI"
    },
    provenance: {
      provider: string,          // e.g. "HRC"
      scenario: string,
      note: string,
      derivation: string,        // how the data was produced/derived
      references: { [name: string]: string },        // e.g. URLs
      nodeSources?: { [nodeKey: string]: { [k: string]: string | number } },
    },
    assumptions: { [key: string]: string | number | boolean },
    actions: [             // non-empty, unique codes, resolver order
      { code: string, kind: "FOLD" | "CHECK" | "CALL" | "BET" | "RAISE" | "ALL_IN",
        label: string, amountBb?: number,
        ru?: { button: string, inline: string, short: string, always?: string } },
    ],
    nodes: [               // non-empty, unique keys
      {
        key: string,                 // decision point, e.g. "UTG" or "BB_VS_BTN_OPEN"
        actionCodes: string[],       // subset of dataset actions, same relative order
        hands: {                     // exactly the 169 canonical hand classes
          "AA": { "<actionCode>": { frequency: number, evBb?: number }, ... },
          ...
        },
      },
    ],
  },
}
```

### Rules enforced by `validateNormalizedSolverDatasetV1`

Fail closed — invalid data throws `AcademyStrategyDatasetValidationError`;
nothing is normalized, clamped or filled in.

- `schemaVersion` is supported (currently only `1`).
- `id` is non-empty and not already registered (`existingDatasetIds`).
- `version`, `title`, `metadata`, `provenance`, `assumptions` are valid.
- `actions` is non-empty; codes unique; `kind` from the vocabulary above;
  `label` non-empty; `amountBb` finite and positive when present.
- `nodes` is non-empty with unique keys; each node's `actionCodes` are
  declared dataset actions in the dataset's order.
- Every node contains all 169 canonical hand classes
  (`CANONICAL_STARTING_HANDS`) and no unknown hand class.
- Every hand lists exactly the node's action codes (none missing, none extra).
- Every frequency is a finite number in `[0, 1]`; a hand's frequencies sum to
  1 within `ACADEMY_STRATEGY_FREQUENCY_SUM_EPSILON` (1e-9).
- `evBb` is optional; if present it must be finite (no NaN/Infinity).

### Action identity and resolver order

The action **code** is the identity everywhere (frequencies, sessions,
answers). A node's `actionCodes` order is the randomizer resolver's
cumulative walk order: with `randomizerPercent` in `[0, 100)`, the first
action whose cumulative `frequency * 100` exceeds the randomizer is chosen.

### EV

`evBb` exists in the type only. It is never required, never displayed, is
dropped when converting to the runtime dataset, and values must never be
invented.

### Fingerprints

- **Content** (`serializeNormalizedSolverContentCanonical`,
  `serializeAcademyStrategyContentCanonical`): action identity
  (code/kind/amountBb), node keys, node action order, every frequency, and
  `evBb` if present. Changes iff the strategy changes.
- **Metadata** (`serializeAcademyStrategyMetadataCanonical`): id, title,
  labels, localized copy, provenance, assumptions, metadata codes. Editing
  copy never changes the content fingerprint.

## Adding a real dataset later

1. Obtain a real export file and commit it as a fixture.
2. Implement the tool-specific adapter (e.g. `importHrcSolverExport`) that
   maps it to schema v1 — based on the real file, not assumptions.
3. Validate with `validateNormalizedSolverDatasetV1`, convert with
   `normalizedSolverDatasetToStrategyDataset`, register under a **new** id
   with a committed content fingerprint test.
4. Bind lessons explicitly in `ACADEMY_SOLVER_LESSON_BINDINGS`
   (`config/academy/solver-lessons.ts`) before exposing anything in the
   catalog.
