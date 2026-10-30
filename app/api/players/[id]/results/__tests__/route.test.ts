import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ getProfileResults: vi.fn() }));
vi.mock("@/features/profile-v2", () => m);
const { GET } = await import("../route");
beforeEach(() => { vi.clearAllMocks(); });
it.each(["-1", "1.5", "NaN", "100001", ""])('rejects invalid offset "%s"', async (offset) => {
  const response = await GET(new Request(`http://localhost/api/players/p/results?offset=${offset}`), { params: Promise.resolve({ id: "p" }) });
  expect(response.status).toBe(400);
  expect(m.getProfileResults).not.toHaveBeenCalled();
});
it("serves a bounded public page with no caller-controlled private mode", async () => {
  m.getProfileResults.mockResolvedValue({ player: { id: "p", display_name: "Player" }, items: [], next_offset: null });
  const response = await GET(new Request("http://localhost/api/players/p/results?offset=60"), { params: Promise.resolve({ id: "p" }) });
  expect(response.status).toBe(200);
  expect(m.getProfileResults).toHaveBeenCalledWith("p", 60);
});
