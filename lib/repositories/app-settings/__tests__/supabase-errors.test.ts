import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ result: { data: null, error: null } as { data: unknown; error: unknown }, calls: vi.fn() }));
vi.mock("@/lib/database", () => ({ getSupabaseServer: () => ({ from: () => {
  mocks.calls();
  const chain = { select: () => chain, eq: () => chain, upsert: () => chain, single: async () => mocks.result, maybeSingle: async () => mocks.result };
  return chain;
} }) }));
vi.mock("@/lib/repositories", async () => {
  const { SupabaseAppSettingsRepository } = await import("../SupabaseAppSettingsRepository");
  return { appSettingsRepository: new SupabaseAppSettingsRepository(), tournamentAssetStorageRepository: {} };
});
const { SupabaseAppSettingsRepository } = await import("../SupabaseAppSettingsRepository");
const { PUT } = await import("@/app/api/admin/tournament-visuals/profile/route");
const repo = new SupabaseAppSettingsRepository();
beforeEach(() => { mocks.calls.mockClear(); mocks.result = { data: null, error: null }; });

it("returns null only for a genuinely absent key", async () => {
  expect(await repo.get("missing")).toBeNull();
  mocks.result.data = { value: false }; expect(await repo.get("flag")).toBe(false);
  mocks.result.data = { value: null }; await expect(repo.get("broken")).rejects.toThrow("повреждены");
});
it("propagates Supabase read/write authorization errors and does not expose database details", async () => {
  mocks.result = { data: null, error: { code: "42501", message: "private SQL secret" } };
  await expect(repo.get("key")).rejects.toMatchObject({ code: "42501" });
  await expect(repo.set("key", true)).rejects.not.toThrow("private SQL secret");
});
it("requires a confirmed row from upsert and supports a manual recovery retry", async () => {
  await expect(repo.set("key", true)).rejects.toThrow();
  mocks.result = { data: { key: "key" }, error: null };
  await expect(repo.set("key", true)).resolves.toBeUndefined();
});
it("fails closed through the real service/API instead of emulating atomicity with Supabase get/set", async () => {
  const response = await PUT(new Request("http://isolated.test/profile", { method: "PUT", body: JSON.stringify({ tournamentType: "bounty", geometry: { scale: 175, offsetX: 0, offsetY: 0, opacity: 100 } }) }));
  expect(response.status).toBe(503);
  expect(mocks.calls).not.toHaveBeenCalled();
});
