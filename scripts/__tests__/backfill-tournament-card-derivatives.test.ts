import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TARGET_TYPES,
  applyCardAssetUrl,
  buildCardUrl,
  buildNextRawConfig,
  buildPlan,
  canonicalJSONStringify,
  checkDestination,
  classifyAssetUrl,
  planSha256,
  sha256Hex,
} from "../backfill-tournament-card-derivatives.mjs";

const APP_ORIGIN = "https://re-raise.ru";

describe("TARGET_TYPES", () => {
  it("1) is exactly the seven legacy types, no more, no fewer", () => {
    expect([...TARGET_TYPES].sort()).toEqual(
      ["classic", "bounty", "boss_bounty", "win_the_button", "deep_stack", "mystery_bounty", "phoenix"].sort(),
    );
    expect(TARGET_TYPES).toHaveLength(7);
  });

  it("2) never includes crazy_pineapple", () => {
    expect(TARGET_TYPES).not.toContain("crazy_pineapple");
  });
});

describe("classifyAssetUrl", () => {
  it("3) accepts a relative local storage URL", () => {
    const result = classifyAssetUrl("/storage/tournament-assets/classic-123-abc.png", APP_ORIGIN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.isAbsolute).toBe(false);
      expect(result.filename).toBe("classic-123-abc.png");
    }
  });

  it("4) accepts a same-origin absolute local storage URL", () => {
    const result = classifyAssetUrl(`${APP_ORIGIN}/storage/tournament-assets/classic-123-abc.png`, APP_ORIGIN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.isAbsolute).toBe(true);
      expect(result.origin).toBe(APP_ORIGIN);
      expect(result.filename).toBe("classic-123-abc.png");
    }
  });

  it("5) rejects an external CDN/third-party URL", () => {
    const result = classifyAssetUrl("https://cdn.example.com/storage/tournament-assets/classic.png", APP_ORIGIN);
    expect(result.ok).toBe(false);
  });

  it("6) rejects the built-in /tournament-assets/ path (not /storage/tournament-assets/)", () => {
    const result = classifyAssetUrl("/tournament-assets/classic.png", APP_ORIGIN);
    expect(result.ok).toBe(false);
  });

  it("7) rejects path traversal", () => {
    expect(classifyAssetUrl("/storage/tournament-assets/../../etc/passwd.png", APP_ORIGIN).ok).toBe(false);
    expect(classifyAssetUrl("/storage/tournament-assets/foo/../bar.png", APP_ORIGIN).ok).toBe(false);
  });

  it("8) rejects a URL with a query string or hash fragment", () => {
    expect(classifyAssetUrl("/storage/tournament-assets/classic.png?x=1", APP_ORIGIN).ok).toBe(false);
    expect(classifyAssetUrl("/storage/tournament-assets/classic.png#frag", APP_ORIGIN).ok).toBe(false);
  });

  it("rejects a nested subdirectory path", () => {
    expect(classifyAssetUrl("/storage/tournament-assets/sub/classic.png", APP_ORIGIN).ok).toBe(false);
  });

  it("rejects a non-PNG file", () => {
    expect(classifyAssetUrl("/storage/tournament-assets/classic.jpg", APP_ORIGIN).ok).toBe(false);
  });

  it("rejects an absolute URL on a different origin than NEXT_PUBLIC_APP_URL", () => {
    const result = classifyAssetUrl("https://not-re-raise.example.com/storage/tournament-assets/classic.png", APP_ORIGIN);
    expect(result.ok).toBe(false);
  });
});

describe("buildCardUrl / proposed derivative naming", () => {
  it("9) generates the proposed -card URL from the original filename", () => {
    const classified = classifyAssetUrl("/storage/tournament-assets/classic-123-abc.png", APP_ORIGIN);
    expect(classified.ok).toBe(true);
    if (classified.ok) {
      expect(buildCardUrl(classified)).toBe("/storage/tournament-assets/classic-123-abc-card.png");
    }
  });

  it("10) preserves relative URL style", () => {
    const classified = classifyAssetUrl("/storage/tournament-assets/classic-123-abc.png", APP_ORIGIN);
    if (classified.ok) {
      expect(buildCardUrl(classified).startsWith("/")).toBe(true);
      expect(buildCardUrl(classified).startsWith(APP_ORIGIN)).toBe(false);
    }
  });

  it("11) preserves absolute URL style (same origin)", () => {
    const classified = classifyAssetUrl(`${APP_ORIGIN}/storage/tournament-assets/classic-123-abc.png`, APP_ORIGIN);
    if (classified.ok) {
      expect(buildCardUrl(classified)).toBe(`${APP_ORIGIN}/storage/tournament-assets/classic-123-abc-card.png`);
    }
  });
});

describe("canonicalJSONStringify", () => {
  it("12) is stable regardless of object key order", () => {
    const a = { b: 2, a: 1, c: { y: 2, x: 1 } };
    const b = { a: 1, c: { x: 1, y: 2 }, b: 2 };
    expect(canonicalJSONStringify(a)).toBe(canonicalJSONStringify(b));
  });
});

function baseEntry(overrides: Record<string, unknown> = {}) {
  return {
    tournamentType: "classic",
    status: "PENDING",
    assetUrl: "/storage/tournament-assets/classic-1.png",
    originalSha256: "aaaa",
    originalBytes: 1000,
    originalDimensions: "1024x1024",
    proposedCardUrl: "/storage/tournament-assets/classic-1-card.png",
    cardSha256: "bbbb",
    cardBytes: 200,
    destinationStatus: "MISSING",
    ...overrides,
  };
}

describe("PLAN_SHA256", () => {
  it("13) the same plan produces the same PLAN_SHA256", () => {
    const entries = [baseEntry()];
    const planA = buildPlan({ expectedAppSha: "sha1", rawConfigSha256: "raw1", entries });
    const planB = buildPlan({ expectedAppSha: "sha1", rawConfigSha256: "raw1", entries: [baseEntry()] });
    expect(planSha256(planA)).toBe(planSha256(planB));
  });

  it("14) a changed assetUrl changes PLAN_SHA256", () => {
    const planA = buildPlan({ expectedAppSha: "sha1", rawConfigSha256: "raw1", entries: [baseEntry()] });
    const planB = buildPlan({
      expectedAppSha: "sha1",
      rawConfigSha256: "raw1",
      entries: [baseEntry({ assetUrl: "/storage/tournament-assets/classic-2.png" })],
    });
    expect(planSha256(planA)).not.toBe(planSha256(planB));
  });

  it("15) a changed original SHA256 changes PLAN_SHA256", () => {
    const planA = buildPlan({ expectedAppSha: "sha1", rawConfigSha256: "raw1", entries: [baseEntry()] });
    const planB = buildPlan({
      expectedAppSha: "sha1",
      rawConfigSha256: "raw1",
      entries: [baseEntry({ originalSha256: "cccc" })],
    });
    expect(planSha256(planA)).not.toBe(planSha256(planB));
  });

  it("16) a changed raw config hash changes PLAN_SHA256", () => {
    const planA = buildPlan({ expectedAppSha: "sha1", rawConfigSha256: "raw1", entries: [baseEntry()] });
    const planB = buildPlan({ expectedAppSha: "sha1", rawConfigSha256: "raw2", entries: [baseEntry()] });
    expect(planSha256(planA)).not.toBe(planSha256(planB));
  });

  it("a changed expected app SHA changes PLAN_SHA256", () => {
    const planA = buildPlan({ expectedAppSha: "sha1", rawConfigSha256: "raw1", entries: [baseEntry()] });
    const planB = buildPlan({ expectedAppSha: "sha2", rawConfigSha256: "raw1", entries: [baseEntry()] });
    expect(planSha256(planA)).not.toBe(planSha256(planB));
  });
});

describe("checkDestination", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "backfill-dest-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("17) recognizes a missing destination as MISSING", async () => {
    const result = await checkDestination(join(dir, "does-not-exist-card.png"), sha256Hex(Buffer.from("x")));
    expect(result.state).toBe("MISSING");
  });

  it("17) recognizes an existing destination whose bytes match as EXISTING_MATCH", async () => {
    const bytes = Buffer.from("same-bytes");
    const filePath = join(dir, "match-card.png");
    await writeFile(filePath, bytes);
    const result = await checkDestination(filePath, sha256Hex(bytes));
    expect(result.state).toBe("EXISTING_MATCH");
  });

  it("18) an existing destination with different bytes reports CONFLICT (must fail before any DB mutation)", async () => {
    const filePath = join(dir, "conflict-card.png");
    await writeFile(filePath, Buffer.from("unexpected-existing-bytes"));
    const result = await checkDestination(filePath, sha256Hex(Buffer.from("expected-bytes")));
    expect(result.state).toBe("CONFLICT");
  });
});

describe("applyCardAssetUrl / buildNextRawConfig -- config transform", () => {
  const classicConfig = {
    tournamentType: "classic",
    assetUrl: "/storage/tournament-assets/classic-1.png",
    scale: 120,
    offsetX: -10,
    offsetY: 5,
    opacity: 85,
    list: { scale: 90, offsetX: 3, offsetY: -3, opacity: 80 },
    someFutureUnknownField: "keep-me",
  };

  it("19) adds ONLY cardAssetUrl, nothing else", () => {
    const result = applyCardAssetUrl(classicConfig, "/storage/tournament-assets/classic-1-card.png");
    const { cardAssetUrl, ...rest } = result;
    expect(cardAssetUrl).toBe("/storage/tournament-assets/classic-1-card.png");
    expect(rest).toEqual(classicConfig);
  });

  it("20) preserves main geometry (scale/offsetX/offsetY/opacity)", () => {
    const result = applyCardAssetUrl(classicConfig, "/x-card.png");
    expect(result.scale).toBe(120);
    expect(result.offsetX).toBe(-10);
    expect(result.offsetY).toBe(5);
    expect(result.opacity).toBe(85);
  });

  it("21) preserves list geometry", () => {
    const result = applyCardAssetUrl(classicConfig, "/x-card.png");
    expect(result.list).toEqual({ scale: 90, offsetX: 3, offsetY: -3, opacity: 80 });
  });

  it("22) preserves unknown/future config properties", () => {
    const result = applyCardAssetUrl(classicConfig, "/x-card.png");
    expect(result.someFutureUnknownField).toBe("keep-me");
  });

  it("23) buildNextRawConfig leaves non-target entries completely unchanged", () => {
    const rawConfig = {
      classic: classicConfig,
      bounty: { tournamentType: "bounty", assetUrl: "/storage/tournament-assets/bounty-1.png", scale: 100, offsetX: 0, offsetY: 0, opacity: 100 },
    };
    const next = buildNextRawConfig(rawConfig, new Map([["classic", "/storage/tournament-assets/classic-1-card.png"]])) as Record<string, Record<string, unknown>>;
    expect(next.bounty).toBe(rawConfig.bounty); // untouched, same reference
    expect(next.classic.cardAssetUrl).toBe("/storage/tournament-assets/classic-1-card.png");
  });

  it("24) buildNextRawConfig never touches crazy_pineapple", () => {
    const pineappleConfig = {
      tournamentType: "crazy_pineapple",
      assetUrl: "/tournament-assets/pineapple.png",
      cardAssetUrl: "/tournament-assets/pineapple-card.png",
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      opacity: 100,
    };
    const rawConfig = { classic: classicConfig, crazy_pineapple: pineappleConfig };
    // Even if a caller mistakenly included crazy_pineapple in the update map,
    // buildNextRawConfig only ever receives keys the orchestration collected
    // from TARGET_TYPES -- but assert here that a config NOT present in the
    // update map is untouched regardless.
    const next = buildNextRawConfig(rawConfig, new Map([["classic", "/storage/tournament-assets/classic-1-card.png"]])) as Record<string, Record<string, unknown>>;
    expect(next.crazy_pineapple).toBe(pineappleConfig); // untouched, same reference
  });

  it("does not update an entry already present with cardAssetUrl unless explicitly targeted", () => {
    const alreadyHasCard = {
      tournamentType: "phoenix",
      assetUrl: "/storage/tournament-assets/phoenix-1.png",
      cardAssetUrl: "/storage/tournament-assets/phoenix-1-card.png",
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      opacity: 100,
    };
    const rawConfig = { phoenix: alreadyHasCard };
    const next = buildNextRawConfig(rawConfig, new Map()) as Record<string, Record<string, unknown>>;
    expect(next.phoenix).toBe(alreadyHasCard);
  });
});
