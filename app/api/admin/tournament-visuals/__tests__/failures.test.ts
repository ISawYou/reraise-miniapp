import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fail: vi.fn() }));
vi.mock("@/features/tournament-visuals", () => ({
  getTournamentVisualConfigs: mocks.fail, saveTournamentVisualConfig: mocks.fail,
  saveTournamentVisualProfileGeometry: mocks.fail, resetTournamentVisualProfileGeometry: mocks.fail,
  resetTournamentVisualConfig: mocks.fail, resetTournamentVisualListOverride: mocks.fail, uploadTournamentVisualPng: mocks.fail,
}));
const root = await import("../route");
const profile = await import("../profile/route");
const mainReset = await import("../reset/route");
const listReset = await import("../reset-list/route");
const upload = await import("../upload/route");
const json = (body: unknown, method = "POST") => new Request("http://isolated.test/api/admin/tournament-visuals", { method, body: JSON.stringify(body) });
beforeEach(() => { mocks.fail.mockReset().mockRejectedValue(new Error("postgres private SQL password fixture")); });

it.each([
  ["GET", () => root.GET()],
  ["PUT", () => root.PUT(json({ tournamentType: "bounty", surface: "main", geometry: {} }, "PUT"))],
  ["Profile PUT", () => profile.PUT(json({ tournamentType: "bounty", geometry: {} }, "PUT"))],
  ["Profile DELETE", () => profile.DELETE(json({ tournamentType: "bounty" }, "DELETE"))],
  ["Main reset", () => mainReset.POST(json({ tournamentType: "bounty" }))],
  ["List reset", () => listReset.POST(json({ tournamentType: "bounty" }))],
] as const)("%s reports storage failure as 500 with sanitized response and logs", async (_name, call) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await call(); expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/postgres|private|SQL|password/);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/postgres|private|SQL|password/);
  } finally { log.mockRestore(); }
});
it("upload storage failure is 500, never a validation error", async () => {
  const form = new FormData(); form.set("tournamentType", "bounty"); form.set("file", new File(["fixture"], "x.png", { type: "image/png" }));
  const request = new Request("http://isolated.test/upload", { method: "POST" }); vi.spyOn(request, "formData").mockResolvedValue(form);
  const response = await upload.POST(request); expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("password");
});
it.each([null, [], 4].map(value => [value]))("malformed command %s is 400 without invoking persistence", async value => {
  for (const call of [() => profile.PUT(json(value, "PUT")), () => profile.DELETE(json(value, "DELETE")), () => mainReset.POST(json(value)), () => listReset.POST(json(value))]) expect((await call()).status).toBe(400);
  expect(mocks.fail).not.toHaveBeenCalled();
});
