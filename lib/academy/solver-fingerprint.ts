/**
 * SHA-256 fingerprints of a strategy dataset (Node-only; regression guards).
 *
 * - `content`: strategy data only (action identity, nodes, hands,
 *   frequencies). Changes iff the answer key changes.
 * - `metadata`: descriptive data only (id, title, labels, localized copy,
 *   provenance, assumptions, metadata codes). Changing a label never touches
 *   `content`.
 */
import { createHash } from "node:crypto";
import {
  serializeAcademyStrategyContentCanonical,
  serializeAcademyStrategyMetadataCanonical,
} from "@/lib/academy/solver";
import type { AcademyStrategyDataset } from "@/types/academy";

export type AcademyStrategyFingerprints = {
  readonly content: string;
  readonly metadata: string;
};

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function computeAcademyStrategyFingerprints(dataset: AcademyStrategyDataset): AcademyStrategyFingerprints {
  return {
    content: sha256Hex(serializeAcademyStrategyContentCanonical(dataset)),
    metadata: sha256Hex(serializeAcademyStrategyMetadataCanonical(dataset)),
  };
}
