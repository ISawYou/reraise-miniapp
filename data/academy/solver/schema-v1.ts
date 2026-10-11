/**
 * RERAISE normalized solver dataset interchange format — schema v1.
 *
 * A RERAISE-owned, tool-agnostic format for FUTURE solver dataset imports
 * (see ./README.md). Nothing in production reads files in this format yet:
 * the only production dataset is built by the compatibility adapter in
 * `config/academy/solver-datasets.ts`.
 *
 * There is NO real HRC (or other solver) export fixture in this repository,
 * so there is intentionally no HRC-specific parser here — see
 * `importHrcSolverExport`, an explicit unimplemented boundary.
 *
 * Optional per-action `evBb` is modelled in the TYPE only: it is never
 * required, never displayed, never carried into the runtime dataset, and no
 * value is invented anywhere.
 */
import { CANONICAL_STARTING_HANDS } from "@/lib/academy/preflop";
import {
  AcademyStrategyDatasetValidationError,
  serializeCanonicalJson,
  toAcademyStrategyContent,
  validateAcademyStrategyActionDefinitions,
  validateAcademyStrategyAssumptions,
  validateAcademyStrategyDataset,
  validateAcademyStrategyHandFrequencies,
  validateAcademyStrategyHandKeys,
  validateAcademyStrategyMetadata,
  validateAcademyStrategyNodeActionCodes,
  validateAcademyStrategyProvenance,
} from "@/lib/academy/solver";
import type {
  AcademyStrategyActionCode,
  AcademyStrategyActionDefinition,
  AcademyStrategyAssumptions,
  AcademyStrategyDataset,
  AcademyStrategyHandFrequencies,
  AcademyStrategyMetadata,
  AcademyStrategyNode,
  AcademyStrategyNodeKey,
  AcademyStrategyProvenance,
  StartingHandClass,
} from "@/types/academy";

export const ACADEMY_SOLVER_SCHEMA_VERSION_V1 = 1 as const;

/** Schema versions this validator accepts. */
export const SUPPORTED_ACADEMY_SOLVER_SCHEMA_VERSIONS: readonly number[] = Object.freeze([
  ACADEMY_SOLVER_SCHEMA_VERSION_V1,
]);

/** One action's strategy for one hand. */
export type NormalizedSolverActionStrategyV1 = {
  /** Frequency in [0, 1]; a hand's frequencies sum to 1 (±1e-9). */
  readonly frequency: number;
  /** OPTIONAL expected value in big blinds. Never required, never displayed. */
  readonly evBb?: number;
};

export type NormalizedSolverHandStrategyV1 = Readonly<Record<AcademyStrategyActionCode, NormalizedSolverActionStrategyV1>>;

export type NormalizedSolverNodeV1 = {
  readonly key: AcademyStrategyNodeKey;
  /** Subset of the dataset's action codes, in the dataset's declared order. */
  readonly actionCodes: readonly AcademyStrategyActionCode[];
  /** All 169 canonical hand classes, each with exactly `actionCodes`. */
  readonly hands: Readonly<Record<StartingHandClass, NormalizedSolverHandStrategyV1>>;
};

export type NormalizedSolverDatasetV1 = {
  readonly schemaVersion: typeof ACADEMY_SOLVER_SCHEMA_VERSION_V1;
  readonly dataset: {
    readonly id: string;
    readonly version: number;
    readonly title: string;
    readonly metadata: AcademyStrategyMetadata;
    readonly provenance: AcademyStrategyProvenance;
    readonly assumptions: AcademyStrategyAssumptions;
    readonly actions: readonly AcademyStrategyActionDefinition[];
    /** Array (not a map) so duplicate node keys are detectable. */
    readonly nodes: readonly NormalizedSolverNodeV1[];
  };
};

export type ValidateNormalizedSolverDatasetOptions = {
  /** Ids already registered; the document's id must not collide with them. */
  readonly existingDatasetIds?: Iterable<string>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(datasetId: string, message: string): never {
  throw new AcademyStrategyDatasetValidationError(`Strategy dataset "${datasetId}": ${message}`);
}

const ACTION_STRATEGY_FIELDS: readonly string[] = ["frequency", "evBb"];

/**
 * Fail-closed validator for a schema-v1 document. Checks: supported schema
 * version; non-empty id not colliding with `existingDatasetIds`; version,
 * title, metadata, provenance and assumptions; a non-empty list of valid,
 * uniquely-coded action definitions; a non-empty list of nodes with unique
 * keys; per node, valid action codes, exactly the 169 canonical hands, and
 * per hand exactly the node's action codes, each `{frequency, evBb?}` with a
 * finite frequency in [0, 1] summing to 1 (±1e-9) and, if present, a finite
 * `evBb`. Never normalizes, clamps or fills in data. Returns the input typed.
 */
export function validateNormalizedSolverDatasetV1(
  input: unknown,
  options: ValidateNormalizedSolverDatasetOptions = {},
): NormalizedSolverDatasetV1 {
  if (!isPlainObject(input)) fail("<unknown>", "document must be an object");
  if (typeof input.schemaVersion !== "number" || !SUPPORTED_ACADEMY_SOLVER_SCHEMA_VERSIONS.includes(input.schemaVersion)) {
    fail("<unknown>", `unsupported schemaVersion ${String(input.schemaVersion)}`);
  }
  const dataset = input.dataset;
  if (!isPlainObject(dataset)) fail("<unknown>", "dataset must be an object");
  if (typeof dataset.id !== "string" || dataset.id.trim().length === 0) {
    fail("<unknown>", "id must be a non-empty string");
  }
  const datasetId = dataset.id;
  for (const existing of options.existingDatasetIds ?? []) {
    if (existing === datasetId) fail(datasetId, "dataset id must be unique within the registry");
  }
  if (typeof dataset.version !== "number" || !Number.isInteger(dataset.version) || dataset.version < 1) {
    fail(datasetId, "version must be a positive integer");
  }
  if (typeof dataset.title !== "string" || dataset.title.trim().length === 0) {
    fail(datasetId, "title must be a non-empty string");
  }
  validateAcademyStrategyMetadata(datasetId, dataset.metadata);
  validateAcademyStrategyProvenance(datasetId, dataset.provenance);
  validateAcademyStrategyAssumptions(datasetId, dataset.assumptions);
  validateAcademyStrategyActionDefinitions(datasetId, dataset.actions);
  const datasetActionCodes = (dataset.actions as AcademyStrategyActionDefinition[]).map((action) => action.code);

  if (!Array.isArray(dataset.nodes) || dataset.nodes.length === 0) fail(datasetId, "nodes must be a non-empty list");
  const nodeKeys = new Set<string>();
  for (const node of dataset.nodes as unknown[]) {
    if (!isPlainObject(node) || typeof node.key !== "string" || node.key.trim().length === 0) {
      fail(datasetId, "node keys must be non-empty strings");
    }
    const nodeKey = node.key;
    if (nodeKeys.has(nodeKey)) fail(datasetId, `node keys must be unique (duplicate ${nodeKey})`);
    nodeKeys.add(nodeKey);
    validateAcademyStrategyNodeActionCodes(datasetId, nodeKey, node.actionCodes, datasetActionCodes);
    const actionCodes = node.actionCodes as readonly string[];
    validateAcademyStrategyHandKeys(datasetId, nodeKey, node.hands);
    const hands = node.hands as Record<string, unknown>;

    for (const hand of CANONICAL_STARTING_HANDS) {
      const strategy = hands[hand];
      if (!isPlainObject(strategy)) fail(datasetId, `${nodeKey} ${hand} has no action-strategy map`);
      const frequencies: Record<string, unknown> = {};
      for (const [action, entry] of Object.entries(strategy)) {
        if (!actionCodes.includes(action)) fail(datasetId, `${nodeKey} ${hand} uses unknown action ${action}`);
        if (!isPlainObject(entry)) fail(datasetId, `${nodeKey} ${hand} ${action} must be {frequency, evBb?}`);
        for (const field of Object.keys(entry)) {
          if (!ACTION_STRATEGY_FIELDS.includes(field)) {
            fail(datasetId, `${nodeKey} ${hand} ${action} has unknown field ${field}`);
          }
        }
        if (entry.evBb !== undefined && (typeof entry.evBb !== "number" || !Number.isFinite(entry.evBb))) {
          fail(datasetId, `${nodeKey} ${hand} ${action} evBb ${String(entry.evBb)} must be a finite number`);
        }
        frequencies[action] = entry.frequency;
      }
      validateAcademyStrategyHandFrequencies(datasetId, nodeKey, hand, frequencies, actionCodes);
    }
  }

  return input as NormalizedSolverDatasetV1;
}

/**
 * Converts a VALIDATED schema-v1 document into an immutable runtime dataset
 * (frequencies only — `evBb` is intentionally dropped; the runtime carries no
 * EV). Re-validates both the document and the result, fail closed.
 *
 * This is the boundary for RERAISE-format data only. It does not register
 * anything: adding a dataset to `ACADEMY_STRATEGY_DATASETS` is a separate,
 * reviewed code change.
 */
export function normalizedSolverDatasetToStrategyDataset(
  input: unknown,
  options: ValidateNormalizedSolverDatasetOptions = {},
): AcademyStrategyDataset {
  const { dataset } = validateNormalizedSolverDatasetV1(input, options);
  const nodes: Record<string, AcademyStrategyNode> = {};
  for (const node of dataset.nodes) {
    const hands = {} as Record<StartingHandClass, AcademyStrategyHandFrequencies>;
    for (const hand of CANONICAL_STARTING_HANDS) {
      hands[hand] = Object.freeze(Object.fromEntries(
        node.actionCodes.map((code) => [code, node.hands[hand][code].frequency]),
      ));
    }
    nodes[node.key] = Object.freeze({
      key: node.key,
      actionCodes: Object.freeze([...node.actionCodes]),
      hands: Object.freeze(hands),
    });
  }
  const result: AcademyStrategyDataset = Object.freeze({
    id: dataset.id,
    version: dataset.version,
    title: dataset.title,
    metadata: Object.freeze({ ...dataset.metadata }),
    provenance: Object.freeze({ ...dataset.provenance }),
    assumptions: Object.freeze({ ...dataset.assumptions }),
    actions: Object.freeze(dataset.actions.map((action) => Object.freeze({ ...action }))),
    nodes: Object.freeze(nodes),
  });
  validateAcademyStrategyDataset(result);
  return result;
}

/** Exports a runtime dataset to schema v1 (frequencies only, no EV). */
export function strategyDatasetToNormalizedV1(dataset: AcademyStrategyDataset): NormalizedSolverDatasetV1 {
  return {
    schemaVersion: ACADEMY_SOLVER_SCHEMA_VERSION_V1,
    dataset: {
      id: dataset.id,
      version: dataset.version,
      title: dataset.title,
      metadata: dataset.metadata,
      provenance: dataset.provenance,
      assumptions: dataset.assumptions,
      actions: dataset.actions,
      nodes: Object.keys(dataset.nodes).map((nodeKey) => {
        const node = dataset.nodes[nodeKey];
        const hands = {} as Record<StartingHandClass, NormalizedSolverHandStrategyV1>;
        for (const hand of CANONICAL_STARTING_HANDS) {
          hands[hand] = Object.fromEntries(
            node.actionCodes.map((code) => [code, { frequency: node.hands[hand][code] }]),
          );
        }
        return { key: node.key, actionCodes: node.actionCodes, hands };
      }),
    },
  };
}

/**
 * Canonical CONTENT serialization of a schema-v1 document. Identical to
 * `serializeAcademyStrategyContentCanonical` of the converted runtime dataset
 * when no `evBb` is present; when any `evBb` is present it is included (per
 * node, under `evBb`), so an EV change is a content change. Labels, titles,
 * provenance and other metadata never affect it.
 */
export function serializeNormalizedSolverContentCanonical(input: unknown): string {
  const document = validateNormalizedSolverDatasetV1(input);
  const content = toAcademyStrategyContent(normalizedSolverDatasetToStrategyDataset(document)) as {
    nodes: Record<string, Record<string, unknown>>;
  };
  for (const node of document.dataset.nodes) {
    const ev: Record<string, Record<string, number>> = {};
    for (const hand of CANONICAL_STARTING_HANDS) {
      for (const code of node.actionCodes) {
        const evBb = node.hands[hand][code].evBb;
        if (evBb !== undefined) (ev[hand] ??= {})[code] = evBb;
      }
    }
    if (Object.keys(ev).length > 0) content.nodes[node.key] = { ...content.nodes[node.key], evBb: ev };
  }
  return serializeCanonicalJson(content);
}

export class AcademySolverImportNotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcademySolverImportNotImplementedError";
  }
}

/**
 * UNIMPLEMENTED import boundary for native HRC exports.
 *
 * No real HRC export fixture exists in this repository, and HRC's native
 * JSON schema must not be guessed. When a real export is provided, implement
 * an adapter here that maps it to `NormalizedSolverDatasetV1` and then runs
 * `validateNormalizedSolverDatasetV1` — never straight into the runtime.
 */
export function importHrcSolverExport(rawExport: unknown): NormalizedSolverDatasetV1 {
  void rawExport;
  throw new AcademySolverImportNotImplementedError(
    "HRC export import is not implemented: no real HRC export fixture has been provided yet.",
  );
}
