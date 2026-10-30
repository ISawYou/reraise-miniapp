import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultTournamentVisual, TOURNAMENT_VISUAL_TYPES } from "@/config/tournament-visuals";

const mocks = vi.hoisted(() => ({
  store: null as unknown,
  upload: vi.fn(), derivative: vi.fn(),
}));
vi.mock("@/lib/repositories", () => ({
  appSettingsRepository: {
    get: async () => structuredClone(mocks.store),
    updateObject: async (_key: string, mutate: (current: Record<string, unknown>) => Record<string, unknown>) => {
      const next = mutate(structuredClone(mocks.store ?? {}) as Record<string, unknown>);
      mocks.store = structuredClone(next); return next;
    },
  },
  tournamentAssetStorageRepository: { upload: mocks.upload },
}));
vi.mock("@/lib/tournament-visual-card-derivative", () => ({ createTournamentCardDerivative: mocks.derivative }));
const f = await import("../tournament-visuals");
const geometry = { scale: 175, offsetX: 4, offsetY: -2, opacity: 90 };
const base = { ...getDefaultTournamentVisual("bounty"), assetUrl: "/stored.png", cardAssetUrl: "/stored-card.png", list: { scale: 90, offsetX: 1, offsetY: 2, opacity: 80 }, profile: { scale: 140, offsetX: 0, offsetY: 0, opacity: 100 }, future: { keep: true } };
function file() { return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "a.png", { type: "image/png" }); }
beforeEach(() => {
  mocks.store = { bounty: structuredClone(base), metadata: { version: 2 } };
  mocks.upload.mockReset().mockImplementation(async (name: string) => `/storage/${name}`);
  mocks.derivative.mockReset().mockResolvedValue(Buffer.from([1, 2, 3]));
});

describe("tournament visual read compatibility", () => {
  it("reads all eleven defaults for a genuinely missing key without persisting them", async () => {
    mocks.store = null;
    expect(await f.getTournamentVisualConfigs()).toEqual(TOURNAMENT_VISUAL_TYPES.map(getDefaultTournamentVisual));
    expect(mocks.store).toBeNull();
  });
  it("supports partially populated and legacy configs without profile geometry", async () => {
    mocks.store = { bounty: { assetUrl: "/legacy.png", scale: 125 } };
    const config = (await f.getTournamentVisualConfigs()).find(c => c.tournamentType === "bounty")!;
    expect(config).toMatchObject({ assetUrl: "/legacy.png", scale: 125, offsetX: 0 });
    expect(config.profile).toBeUndefined();
  });
  it("inherits a built-in derivative only for its matching original", async () => {
    mocks.store = { crazy_pineapple: { assetUrl: "/tournament-assets/pineapple.png", scale: 130 } };
    expect((await f.getTournamentVisualConfigs()).find(c => c.tournamentType === "crazy_pineapple")?.cardAssetUrl).toBe("/tournament-assets/pineapple-card.png");
    mocks.store = { crazy_pineapple: { assetUrl: "/custom.png" } };
    expect((await f.getTournamentVisualConfigs()).find(c => c.tournamentType === "crazy_pineapple")?.cardAssetUrl).toBeUndefined();
  });
  it.each(["invalid", [], { bounty: null }, { bounty: { assetUrl: 2 } }, { bounty: { list: null } }, { bounty: { profile: { scale: "bad" } } }])("rejects corrupt stored data without overwriting it: %s", async (raw) => {
    mocks.store = raw; const before = structuredClone(raw);
    await expect(f.getTournamentVisualConfigs()).rejects.toThrow("повреждены");
    await expect(f.saveTournamentVisualProfileGeometry("classic", geometry)).rejects.toThrow("повреждены");
    expect(mocks.store).toEqual(before);
  });
});

describe("narrow surface commands", () => {
  it("sets only Profile geometry, ignoring client asset and other-surface fields", async () => {
    await f.saveTournamentVisualProfileGeometry("bounty", { ...geometry, assetUrl: "/bad.png", list: {} });
    expect(mocks.store).toEqual({ bounty: { ...base, profile: geometry }, metadata: { version: 2 } });
  });
  it.each(["main", "list"])("sets only %s geometry despite stale extra snapshot fields", async (surface) => {
    await f.saveTournamentVisualConfig({ tournamentType: "bounty", surface, geometry, assetUrl: "/stale.png", profile: { scale: 50 } });
    expect(mocks.store).toEqual({ bounty: surface === "main" ? { ...base, ...geometry } : { ...base, list: geometry }, metadata: { version: 2 } });
  });
  it("rejects the old ambiguous full-snapshot command", async () => {
    await expect(f.saveTournamentVisualConfig(base)).rejects.toThrow("поверхность");
    expect(mocks.store).toEqual({ bounty: base, metadata: { version: 2 } });
  });
  it("saves one absent type without persisting defaults for other types", async () => {
    mocks.store = null;
    await f.saveTournamentVisualProfileGeometry("bounty", geometry);
    expect(mocks.store).toEqual({ bounty: { tournamentType: "bounty", profile: geometry } });
  });
  it("Profile and List resets remove only their intended override", async () => {
    await f.resetTournamentVisualProfileGeometry("bounty");
    const withoutProfile: Partial<typeof base> = { ...base }; delete withoutProfile.profile;
    expect(mocks.store).toEqual({ bounty: withoutProfile, metadata: { version: 2 } });
    mocks.store = { bounty: base };
    await f.resetTournamentVisualListOverride("bounty");
    const withoutList: Partial<typeof base> = { ...base }; delete withoutList.list;
    expect(mocks.store).toEqual({ bounty: withoutList });
  });
  it("Main reset preserves Profile and unknown fields, with existing Main/list/asset reset semantics", async () => {
    await f.resetTournamentVisualConfig("bounty");
    expect(mocks.store).toEqual({ bounty: { ...getDefaultTournamentVisual("bounty"), profile: base.profile, future: base.future }, metadata: { version: 2 } });
  });
  it("preserves unknown geometry extensions when editing a surface", async () => {
    mocks.store = { bounty: { ...base, profile: { ...base.profile, future: 1 } } };
    await f.saveTournamentVisualProfileGeometry("bounty", geometry);
    expect((mocks.store as typeof base & { bounty: { profile: object } }).bounty.profile).toEqual({ future: 1, ...geometry });
  });
  it.each([49, 301, 100.5, NaN])("rejects invalid Profile scale %s without persistence", async (scale) => {
    await expect(f.saveTournamentVisualProfileGeometry("bounty", { ...geometry, scale })).rejects.toThrow();
    expect(mocks.store).toEqual({ bounty: base, metadata: { version: 2 } });
  });
  it("keeps Profile upper bound 300 and main/list upper bound 200", async () => {
    expect((await f.saveTournamentVisualProfileGeometry("bounty", { ...geometry, scale: 300 })).profile?.scale).toBe(300);
    await expect(f.saveTournamentVisualConfig({ tournamentType: "bounty", surface: "main", geometry: { ...geometry, scale: 201 } })).rejects.toThrow();
  });
});

describe("upload failure and preservation", () => {
  it("generates a derivative before storage and only replaces artwork URLs", async () => {
    const result = await f.uploadTournamentVisualPng("bounty", file());
    expect(result).toMatchObject({ list: base.list, profile: base.profile, future: base.future });
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    const original = mocks.upload.mock.calls[0][0] as string;
    expect(mocks.upload.mock.calls[1][0]).toBe(original.replace(".png", "-card.png"));
    expect(mocks.derivative.mock.invocationCallOrder[0]).toBeLessThan(mocks.upload.mock.invocationCallOrder[0]);
  });
  it.each(["derivative", "original", "card"])("does not change config on %s failure", async (stage) => {
    const before = structuredClone(mocks.store);
    if (stage === "derivative") mocks.derivative.mockRejectedValue(new Error("resize failed"));
    else if (stage === "original") mocks.upload.mockRejectedValueOnce(new Error("upload failed"));
    else mocks.upload.mockResolvedValueOnce("/stored-original.png").mockRejectedValueOnce(new Error("upload failed"));
    await expect(f.uploadTournamentVisualPng("bounty", file())).rejects.toThrow();
    expect(mocks.store).toEqual(before);
  });
  it("validates file type and short PNGs before any upload", async () => {
    await expect(f.uploadTournamentVisualPng("bounty", new File(["x"], "x.png", { type: "image/png" }))).rejects.toThrow();
    await expect(f.uploadTournamentVisualPng("bounty", new File(["12345678"], "x.txt", { type: "text/plain" }))).rejects.toThrow();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
