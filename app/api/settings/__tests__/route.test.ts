import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/app-settings", () => ({ getAppSetting: mocks.get }));
const { GET } = await import("../route");
beforeEach(() => { mocks.get.mockReset(); });
it("keeps disabled defaults for genuinely missing feature flags", async () => {
  mocks.get.mockResolvedValue(null);
  const response = await GET(); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ show_email_link_prompt: false, include_admin_activity: false, automatic_achievements_enabled: false });
});
it("does not disguise a settings read outage as a successful defaults response", async () => {
  mocks.get.mockRejectedValue(new Error("read unavailable"));
  const response = await GET(); expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Не удалось загрузить настройки" });
});
