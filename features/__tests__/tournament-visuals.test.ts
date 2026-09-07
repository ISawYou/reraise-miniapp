import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory fake of the ONE app_settings row this feature reads/writes --
// mirrors AppSettingsRepository's real get/set contract closely enough for
// this feature's own logic (parsing/merging/validation) to be exercised
// genuinely, without touching Postgres/Supabase.
const mocks = vi.hoisted(() => {
  let store: Record<string, unknown> | null = null;
  return {
    appSettingsGet: vi.fn(async (key: string) => (key === "tournament_visuals" ? store : null)),
    appSettingsSet: vi.fn(async (key: string, value: unknown) => {
      if (key === "tournament_visuals") store = value as Record<string, unknown>;
    }),
    resetStore: () => {
      store = null;
    },
    uploadOriginal: vi.fn(),
    uploadCard: vi.fn(),
    createDerivative: vi.fn(),
  };
});

vi.mock("@/lib/repositories", () => ({
  appSettingsRepository: { get: mocks.appSettingsGet, set: mocks.appSettingsSet },
  tournamentAssetStorageRepository: {
    upload: vi.fn(async (fileName: string, bytes: unknown) =>
      fileName.endsWith("-card.png") ? mocks.uploadCard(fileName, bytes) : mocks.uploadOriginal(fileName, bytes),
    ),
  },
}));

vi.mock("@/lib/tournament-visual-card-derivative", () => ({
  createTournamentCardDerivative: mocks.createDerivative,
}));

const {
  getTournamentVisualConfigs,
  saveTournamentVisualConfig,
  resetTournamentVisualConfig,
  resetTournamentVisualListOverride,
  uploadTournamentVisualPng,
} = await import("@/features/tournament-visuals");

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fakePngFile(bytes = 100): File {
  const buf = new Uint8Array(bytes);
  buf.set(PNG_HEADER);
  return new File([buf], "upload.png", { type: "image/png" });
}

beforeEach(() => {
  mocks.resetStore();
  mocks.uploadOriginal.mockReset().mockResolvedValue("/storage/tournament-assets/original.png");
  mocks.uploadCard.mockReset().mockResolvedValue("/storage/tournament-assets/original-card.png");
  mocks.createDerivative.mockReset().mockResolvedValue(Buffer.from([1, 2, 3]));
});

describe("getTournamentVisualConfigs", () => {
  it("returns the built-in default for every type with no stored config", async () => {
    const configs = await getTournamentVisualConfigs();
    const classic = configs.find((c) => c.tournamentType === "classic")!;
    expect(classic.assetUrl).toBe("/tournament-assets/classic.png");
    expect(classic.cardAssetUrl).toBeUndefined();
  });

  it("crazy_pineapple's built-in default includes both assetUrl and cardAssetUrl", async () => {
    const configs = await getTournamentVisualConfigs();
    const pineapple = configs.find((c) => c.tournamentType === "crazy_pineapple")!;
    expect(pineapple.assetUrl).toBe("/tournament-assets/pineapple.png");
    expect(pineapple.cardAssetUrl).toBe("/tournament-assets/pineapple-card.png");
  });

  it("all 8 tournament visual types are present", async () => {
    const configs = await getTournamentVisualConfigs();
    expect(configs.map((c) => c.tournamentType).sort()).toEqual(
      [
        "classic",
        "bounty",
        "boss_bounty",
        "win_the_button",
        "deep_stack",
        "mystery_bounty",
        "phoenix",
        "crazy_pineapple",
      ].sort(),
    );
  });

  it("a stored config pointing at the exact built-in Pineapple original, saved before cardAssetUrl existed, safely inherits the built-in derivative without touching geometry", async () => {
    await saveTournamentVisualConfig({
      tournamentType: "crazy_pineapple",
      assetUrl: "/tournament-assets/pineapple.png",
      scale: 130,
      offsetX: -20,
      offsetY: 10,
      opacity: 90,
    });

    const configs = await getTournamentVisualConfigs();
    const pineapple = configs.find((c) => c.tournamentType === "crazy_pineapple")!;
    expect(pineapple.cardAssetUrl).toBe("/tournament-assets/pineapple-card.png");
    expect(pineapple.scale).toBe(130);
    expect(pineapple.offsetX).toBe(-20);
    expect(pineapple.offsetY).toBe(10);
    expect(pineapple.opacity).toBe(90);
  });

  it("a stored config with a CUSTOM Pineapple asset (different assetUrl) does NOT inherit the built-in derivative", async () => {
    await saveTournamentVisualConfig({
      tournamentType: "crazy_pineapple",
      assetUrl: "/storage/tournament-assets/crazy_pineapple-custom.png",
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      opacity: 100,
    });

    const configs = await getTournamentVisualConfigs();
    const pineapple = configs.find((c) => c.tournamentType === "crazy_pineapple")!;
    expect(pineapple.cardAssetUrl).toBeUndefined();
    expect(pineapple.assetUrl).toBe("/storage/tournament-assets/crazy_pineapple-custom.png");
  });

  it("a legacy stored config for a type with NO built-in derivative (e.g. classic) is returned unchanged, with no guessed '-card' URL", async () => {
    await saveTournamentVisualConfig({
      tournamentType: "classic",
      assetUrl: "/storage/tournament-assets/classic-legacy.png",
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      opacity: 100,
    });

    const configs = await getTournamentVisualConfigs();
    const classic = configs.find((c) => c.tournamentType === "classic")!;
    expect(classic.cardAssetUrl).toBeUndefined();
    expect(classic.assetUrl).toBe("/storage/tournament-assets/classic-legacy.png");
  });
});

describe("saveTournamentVisualConfig -- cardAssetUrl validation", () => {
  it("accepts a config without cardAssetUrl", async () => {
    const saved = await saveTournamentVisualConfig({
      tournamentType: "classic",
      assetUrl: "/tournament-assets/classic.png",
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      opacity: 100,
    });
    expect(saved.cardAssetUrl).toBeUndefined();
  });

  it("accepts a valid relative cardAssetUrl", async () => {
    const saved = await saveTournamentVisualConfig({
      tournamentType: "classic",
      assetUrl: "/tournament-assets/classic.png",
      cardAssetUrl: "/storage/tournament-assets/classic-card.png",
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      opacity: 100,
    });
    expect(saved.cardAssetUrl).toBe("/storage/tournament-assets/classic-card.png");
  });

  it("accepts a valid https cardAssetUrl", async () => {
    const saved = await saveTournamentVisualConfig({
      tournamentType: "classic",
      assetUrl: "/tournament-assets/classic.png",
      cardAssetUrl: "https://cdn.example.com/classic-card.png",
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      opacity: 100,
    });
    expect(saved.cardAssetUrl).toBe("https://cdn.example.com/classic-card.png");
  });

  it("rejects a malformed cardAssetUrl", async () => {
    await expect(
      saveTournamentVisualConfig({
        tournamentType: "classic",
        assetUrl: "/tournament-assets/classic.png",
        cardAssetUrl: "not-a-url",
        scale: 100,
        offsetX: 0,
        offsetY: 0,
        opacity: 100,
      }),
    ).rejects.toThrow();
  });

  it("does not weaken assetUrl's own validation", async () => {
    await expect(
      saveTournamentVisualConfig({
        tournamentType: "classic",
        assetUrl: "not-a-url",
        scale: 100,
        offsetX: 0,
        offsetY: 0,
        opacity: 100,
      }),
    ).rejects.toThrow();
  });

  it("trims cardAssetUrl", async () => {
    const saved = await saveTournamentVisualConfig({
      tournamentType: "classic",
      assetUrl: "/tournament-assets/classic.png",
      cardAssetUrl: "  /storage/tournament-assets/classic-card.png  ",
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      opacity: 100,
    });
    expect(saved.cardAssetUrl).toBe("/storage/tournament-assets/classic-card.png");
  });
});

describe("admin save round-trip preserves cardAssetUrl", () => {
  const base = {
    tournamentType: "classic" as const,
    assetUrl: "/storage/tournament-assets/classic-x.png",
    cardAssetUrl: "/storage/tournament-assets/classic-x-card.png",
    scale: 100,
    offsetX: 0,
    offsetY: 0,
    opacity: 100,
  };

  it("scale edit preserves cardAssetUrl", async () => {
    await saveTournamentVisualConfig(base);
    const saved = await saveTournamentVisualConfig({ ...base, scale: 140 });
    expect(saved.cardAssetUrl).toBe(base.cardAssetUrl);
  });

  it("offset/opacity edits preserve cardAssetUrl", async () => {
    await saveTournamentVisualConfig(base);
    const saved = await saveTournamentVisualConfig({ ...base, offsetX: -30, offsetY: 15, opacity: 70 });
    expect(saved.cardAssetUrl).toBe(base.cardAssetUrl);
  });

  it("list geometry save preserves cardAssetUrl", async () => {
    await saveTournamentVisualConfig(base);
    const saved = await saveTournamentVisualConfig({
      ...base,
      list: { scale: 90, offsetX: 5, offsetY: -5, opacity: 80 },
    });
    expect(saved.cardAssetUrl).toBe(base.cardAssetUrl);
    expect(saved.list).toEqual({ scale: 90, offsetX: 5, offsetY: -5, opacity: 80 });
  });
});

describe("resetTournamentVisualListOverride", () => {
  it("removes only the list override, preserving assetUrl, cardAssetUrl, and main geometry", async () => {
    await saveTournamentVisualConfig({
      tournamentType: "classic",
      assetUrl: "/storage/tournament-assets/classic-x.png",
      cardAssetUrl: "/storage/tournament-assets/classic-x-card.png",
      scale: 120,
      offsetX: -10,
      offsetY: 5,
      opacity: 85,
      list: { scale: 90, offsetX: 5, offsetY: -5, opacity: 80 },
    });

    const result = await resetTournamentVisualListOverride("classic");
    expect(result.list).toBeUndefined();
    expect(result.assetUrl).toBe("/storage/tournament-assets/classic-x.png");
    expect(result.cardAssetUrl).toBe("/storage/tournament-assets/classic-x-card.png");
    expect(result.scale).toBe(120);
    expect(result.offsetX).toBe(-10);
    expect(result.offsetY).toBe(5);
    expect(result.opacity).toBe(85);
  });
});

describe("resetTournamentVisualConfig (full reset)", () => {
  it("discards a custom assetUrl and cardAssetUrl, returning the built-in default", async () => {
    await saveTournamentVisualConfig({
      tournamentType: "crazy_pineapple",
      assetUrl: "/storage/tournament-assets/crazy_pineapple-custom.png",
      cardAssetUrl: "/storage/tournament-assets/crazy_pineapple-custom-card.png",
      scale: 150,
      offsetX: 20,
      offsetY: -20,
      opacity: 50,
    });

    const result = await resetTournamentVisualConfig("crazy_pineapple");
    expect(result.assetUrl).toBe("/tournament-assets/pineapple.png");
    expect(result.cardAssetUrl).toBe("/tournament-assets/pineapple-card.png");
    expect(result.scale).toBe(100);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
    expect(result.opacity).toBe(100);
    expect(result.list).toBeUndefined();
  });

  it("Final Month / other type behavior is unaffected -- resetting classic never touches crazy_pineapple", async () => {
    await saveTournamentVisualConfig({
      tournamentType: "crazy_pineapple",
      assetUrl: "/tournament-assets/pineapple.png",
      scale: 130,
      offsetX: 0,
      offsetY: 0,
      opacity: 100,
    });
    await resetTournamentVisualConfig("classic");

    const configs = await getTournamentVisualConfigs();
    const pineapple = configs.find((c) => c.tournamentType === "crazy_pineapple")!;
    expect(pineapple.scale).toBe(130);
  });
});

describe("uploadTournamentVisualPng", () => {
  it("saves both assetUrl and cardAssetUrl after a successful upload", async () => {
    mocks.uploadOriginal.mockResolvedValue("/storage/tournament-assets/classic-1-abc.png");
    mocks.uploadCard.mockResolvedValue("/storage/tournament-assets/classic-1-abc-card.png");

    const result = await uploadTournamentVisualPng("classic", fakePngFile());
    expect(result.assetUrl).toBe("/storage/tournament-assets/classic-1-abc.png");
    expect(result.cardAssetUrl).toBe("/storage/tournament-assets/classic-1-abc-card.png");
  });

  it("original and derivative filenames share one upload identity (same stem, '-card' suffix on the derivative)", async () => {
    await uploadTournamentVisualPng("classic", fakePngFile());
    const originalName = mocks.uploadOriginal.mock.calls[0][0] as string;
    const cardName = mocks.uploadCard.mock.calls[0][0] as string;
    const stem = originalName.replace(/\.png$/, "");
    expect(cardName).toBe(`${stem}-card.png`);
    expect(originalName).toMatch(/^classic-\d+-[0-9a-f-]+\.png$/);
  });

  it("preserves existing main geometry when replacing artwork", async () => {
    await saveTournamentVisualConfig({
      tournamentType: "classic",
      assetUrl: "/tournament-assets/classic.png",
      scale: 140,
      offsetX: -25,
      offsetY: 12,
      opacity: 65,
    });

    const result = await uploadTournamentVisualPng("classic", fakePngFile());
    expect(result.scale).toBe(140);
    expect(result.offsetX).toBe(-25);
    expect(result.offsetY).toBe(12);
    expect(result.opacity).toBe(65);
  });

  it("preserves existing list geometry when replacing artwork", async () => {
    await saveTournamentVisualConfig({
      tournamentType: "classic",
      assetUrl: "/tournament-assets/classic.png",
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      opacity: 100,
      list: { scale: 88, offsetX: 3, offsetY: -3, opacity: 77 },
    });

    const result = await uploadTournamentVisualPng("classic", fakePngFile());
    expect(result.list).toEqual({ scale: 88, offsetX: 3, offsetY: -3, opacity: 77 });
  });

  it("resize failure does not replace the current visual config", async () => {
    await saveTournamentVisualConfig({
      tournamentType: "classic",
      assetUrl: "/tournament-assets/classic-live.png",
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      opacity: 100,
    });
    mocks.createDerivative.mockRejectedValue(new Error("resize failed"));

    await expect(uploadTournamentVisualPng("classic", fakePngFile())).rejects.toThrow("resize failed");
    expect(mocks.uploadOriginal).not.toHaveBeenCalled();
    expect(mocks.uploadCard).not.toHaveBeenCalled();

    const configs = await getTournamentVisualConfigs();
    expect(configs.find((c) => c.tournamentType === "classic")!.assetUrl).toBe(
      "/tournament-assets/classic-live.png",
    );
  });

  it("original upload failure does not replace the current visual config", async () => {
    await saveTournamentVisualConfig({
      tournamentType: "classic",
      assetUrl: "/tournament-assets/classic-live.png",
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      opacity: 100,
    });
    mocks.uploadOriginal.mockRejectedValue(new Error("upload failed"));

    await expect(uploadTournamentVisualPng("classic", fakePngFile())).rejects.toThrow("upload failed");
    expect(mocks.uploadCard).not.toHaveBeenCalled();

    const configs = await getTournamentVisualConfigs();
    expect(configs.find((c) => c.tournamentType === "classic")!.assetUrl).toBe(
      "/tournament-assets/classic-live.png",
    );
  });

  it("derivative upload failure does not replace the current visual config", async () => {
    await saveTournamentVisualConfig({
      tournamentType: "classic",
      assetUrl: "/tournament-assets/classic-live.png",
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      opacity: 100,
    });
    mocks.uploadCard.mockRejectedValue(new Error("card upload failed"));

    await expect(uploadTournamentVisualPng("classic", fakePngFile())).rejects.toThrow("card upload failed");

    const configs = await getTournamentVisualConfigs();
    expect(configs.find((c) => c.tournamentType === "classic")!.assetUrl).toBe(
      "/tournament-assets/classic-live.png",
    );
  });

  it("config persistence happens only after both uploads succeed -- call order is derivative, original upload, card upload, then save", async () => {
    const order: string[] = [];
    mocks.createDerivative.mockImplementation(async () => {
      order.push("derivative");
      return Buffer.from([1, 2, 3]);
    });
    mocks.uploadOriginal.mockImplementation(async () => {
      order.push("original-upload");
      return "/storage/tournament-assets/classic-x.png";
    });
    mocks.uploadCard.mockImplementation(async () => {
      order.push("card-upload");
      return "/storage/tournament-assets/classic-x-card.png";
    });

    await uploadTournamentVisualPng("classic", fakePngFile());
    expect(order).toEqual(["derivative", "original-upload", "card-upload"]);

    const configs = await getTournamentVisualConfigs();
    expect(configs.find((c) => c.tournamentType === "classic")!.assetUrl).toBe(
      "/storage/tournament-assets/classic-x.png",
    );
  });
});
