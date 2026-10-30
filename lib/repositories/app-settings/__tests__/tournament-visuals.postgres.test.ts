import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as statement } from "drizzle-orm";
import { appSettings } from "@/lib/db/schema/appSettings";
import { getDefaultTournamentVisual, TOURNAMENT_VISUAL_TYPES } from "@/config/tournament-visuals";
import type { db as Database } from "@/lib/db";

// Opt-in only. Never use DATABASE_URL: it might point at a real environment.
const testUrl = process.env.RERAISE_SETTINGS_TEST_DATABASE_URL;
if (testUrl) {
  const parsed = new URL(testUrl);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || !parsed.pathname.startsWith("/reraise_settings_test_")) {
    throw new Error("Refusing settings integration tests outside an explicit disposable localhost database");
  }
}
const h = vi.hoisted(() => ({ db: null as unknown as typeof Database, fault: "", beforeCommit: null as null | (() => Promise<void>), uploads: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_target, prop) {
  const value = Reflect.get(h.db, prop);
  return typeof value === "function" ? value.bind(h.db) : value;
} }) }));
vi.mock("@/lib/repositories", async () => {
  const { PostgresAppSettingsRepository } = await import("../PostgresAppSettingsRepository");
  return { appSettingsRepository: new PostgresAppSettingsRepository(), tournamentAssetStorageRepository: { upload: h.uploads } };
});
vi.mock("@/lib/tournament-visual-card-derivative", () => ({ createTournamentCardDerivative: async () => Buffer.from([1, 2, 3]) }));

const { PostgresAppSettingsRepository } = await import("../PostgresAppSettingsRepository");
const profile = await import("@/app/api/admin/tournament-visuals/profile/route");
const main = await import("@/app/api/admin/tournament-visuals/route");
const resets = await import("@/app/api/admin/tournament-visuals/reset/route");
const listReset = await import("@/app/api/admin/tournament-visuals/reset-list/route");
const upload = await import("@/app/api/admin/tournament-visuals/upload/route");
const { getTournamentVisualConfigs } = await import("@/features/tournament-visuals");
const repo = new PostgresAppSettingsRepository();
const geometry = { scale: 175, offsetX: 4, offsetY: -2, opacity: 90 };
const command = (body: unknown, method = "PUT") => new Request("http://isolated.test/api/admin/tournament-visuals", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const saveProfile = (type: string, scale = 175) => profile.PUT(command({ tournamentType: type, geometry: { ...geometry, scale } }));
const saveSurface = (surface: "main" | "list", scale = 150) => main.PUT(command({ tournamentType: "bounty", surface, geometry: { ...geometry, scale }, assetUrl: "/stale.png", profile: { scale: 50 }, list: { scale: 55, offsetX: -20, offsetY: -20, opacity: 50 } }));
const seed = () => Object.fromEntries([
  ...TOURNAMENT_VISUAL_TYPES.map((type, i) => [type, { ...getDefaultTournamentVisual(type), assetUrl: `/fixture/${type}.png`, cardAssetUrl: `/fixture/${type}-card.png`, scale: 100 + i, list: { scale: 90, offsetX: 1, offsetY: 2, opacity: 80, future: "list" }, profile: { scale: 130, offsetX: 0, offsetY: 0, opacity: 100, future: "profile" }, extension: { keep: type } }]),
  ["future-type", { artwork: "future" }], ["metadata", { version: 3 }],
]);
let client: ReturnType<typeof postgres>;
async function stored() { return (await client`select value from app_settings where key='tournament_visuals'`)[0]?.value; }
// Drizzle configures postgres-js's JSON serializers as transparent; seed with
// the explicit JSON string, just as Drizzle's jsonb column encoder does.
async function seedValue(value: unknown) { await client`insert into app_settings (key,value) values ('tournament_visuals',${JSON.stringify(value)}::jsonb) on conflict(key) do update set value=excluded.value`; }

describe.runIf(!!testUrl)("real PostgreSQL repository → service → admin API safety", () => {
  beforeAll(async () => {
    client = postgres(testUrl!, { max: 16, onnotice: () => {} });
    await client`create table if not exists app_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now())`;
    // Test-only deferred constraint: statement succeeds, COMMIT fails. This
    // exercises a real server-side commit rejection without killing sockets.
    await client`create table if not exists commit_probe (id int primary key deferrable initially deferred)`;
    const actual = drizzle(client, { schema: { appSettings } });
    h.db = new Proxy(actual, { get(target, prop) {
      if (prop === "select" && h.fault === "read") return () => { throw Object.assign(new Error("private SQL and secret fixture"), { code: "42501" }); };
      if (prop === "insert" && h.fault === "write") return () => { throw new Error("private write fixture"); };
      if (prop === "transaction") return (callback: (tx: unknown) => Promise<unknown>, options: Parameters<typeof actual.transaction>[1]) => actual.transaction(async tx => {
        // A genuine PostgreSQL write rejection, not a JS fake of persistence.
        if (h.fault === "write") await tx.execute(statement`set transaction read only`);
        const wrapped = new Proxy(tx, { get(t, p) {
          if (p === "select" && ["read", "conflict"].includes(h.fault)) return () => { throw Object.assign(new Error("private SQL and secret fixture"), { code: h.fault === "conflict" ? "40001" : "42501" }); };
          const value = Reflect.get(t, p); return typeof value === "function" ? value.bind(t) : value;
        } });
        const result = await callback(wrapped);
        const hook = h.beforeCommit; h.beforeCommit = null;
        if (hook) await hook();
        if (h.fault === "commit") await tx.execute(statement`insert into commit_probe(id) values (1), (1)`);
        return result;
      }, options);
      const value = Reflect.get(target, prop); return typeof value === "function" ? value.bind(target) : value;
    } }) as typeof Database;
  });
  beforeEach(async () => {
    h.fault = ""; h.beforeCommit = null;
    h.uploads.mockReset().mockImplementation(async (name: string) => `/fixture/new/${name}`);
    await client`truncate app_settings, commit_probe`;
    await seedValue(seed());
  });
  afterAll(async () => { await client?.end({ timeout: 3 }); });

  it("A: write rejection returns 500, preserves all settings, and a manual retry succeeds", async () => {
    const before = await stored(); h.fault = "write";
    const failed = await saveProfile("bounty");
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toMatch(/private|secret|SQL|postgres/i);
    expect(await stored()).toEqual(before);
    h.fault = "";
    expect((await saveProfile("bounty")).status).toBe(200);
    expect((await stored()).bounty.profile).toEqual({ ...geometry, future: "profile" });
  });
  it("B: read/authorization failure never defaults or replaces any of eleven custom configs", async () => {
    const before = await stored();
    const beforeBytes = (await client`select value::text as bytes from app_settings where key='tournament_visuals'`)[0].bytes;
    h.fault = "read";
    expect((await saveProfile("bounty")).status).toBe(500);
    expect((await main.GET()).status).toBe(500);
    expect(await stored()).toEqual(before);
    expect((await client`select value::text as bytes from app_settings where key='tournament_visuals'`)[0].bytes).toBe(beforeBytes);
    h.fault = "";
    expect((await getTournamentVisualConfigs()).map(c => c.assetUrl)).toEqual(TOURNAMENT_VISUAL_TYPES.map(t => `/fixture/${t}.png`));
  });
  it("propagates generic get/set errors instead of missing/success", async () => {
    h.fault = "read"; await expect(repo.get("tournament_visuals")).rejects.toThrow();
    h.fault = "write"; await expect(repo.set("other", true)).rejects.toThrow();
    expect(await client`select * from app_settings where key='other'`).toHaveLength(0);
  });
  it("propagates a real deferred-constraint COMMIT failure and rolls back the updated value", async () => {
    const before = await stored(); h.fault = "commit";
    expect((await saveProfile("bounty")).status).toBe(500);
    expect(await stored()).toEqual(before);
    h.fault = ""; expect((await saveProfile("bounty")).status).toBe(200);
  });
  it("C: concurrent different types all survive repeated interleaving", async () => {
    for (let round = 0; round < 3; round++) {
      const responses = await Promise.all(TOURNAMENT_VISUAL_TYPES.map((type, i) => saveProfile(type, 170 + i + round)));
      expect(responses.map(r => r.status)).toEqual(TOURNAMENT_VISUAL_TYPES.map(() => 200));
      const value = await stored(); const before = seed();
      for (const [i, type] of TOURNAMENT_VISUAL_TYPES.entries()) {
        expect(value[type]).toEqual({ ...before[type], profile: { ...geometry, scale: 170 + i + round, future: "profile" } });
      }
      expect(value.metadata).toEqual(before.metadata); expect(value["future-type"]).toEqual(before["future-type"]);
    }
  });
  it.each(["list", "main"] as const)("D: same-type Profile + %s edits preserve independent fields despite stale snapshots", async surface => {
    const before = await stored();
    expect((await Promise.all([saveProfile("bounty"), saveSurface(surface)])).map(r => r.status)).toEqual([200, 200]);
    const value = await stored();
    expect(value.bounty.profile).toEqual({ ...geometry, future: "profile" });
    expect(surface === "list" ? value.bounty.list : value.bounty).toMatchObject({ ...geometry, scale: 150 });
    expect(value.bounty.assetUrl).toBe(before.bounty.assetUrl);
    expect(value.bounty.cardAssetUrl).toBe(before.bounty.cardAssetUrl);
    if (surface === "main") expect(value.bounty.list).toEqual(before.bounty.list);
    else expect(value.bounty.scale).toBe(before.bounty.scale);
    for (const type of TOURNAMENT_VISUAL_TYPES.filter(t => t !== "bounty")) expect(value[type]).toEqual(before[type]);
  });
  it("defines same-surface policy: last serialized successful mutation wins, each response reflects its own commit", async () => {
    let entered!: () => void; let release!: () => void;
    const holding = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    h.beforeCommit = async () => { entered(); await gate; };
    const first = saveProfile("bounty", 160); await holding;
    const second = saveProfile("bounty", 180); release();
    const [one, two] = await Promise.all([first, second]);
    expect((await one.json()).visual.profile.scale).toBe(160);
    expect((await two.json()).visual.profile.scale).toBe(180);
    expect((await stored()).bounty.profile.scale).toBe(180);
  });
  it("waits on a row lock held by an independent PostgreSQL client, not an app-process mutex", async () => {
    const external = postgres(testUrl!, { max: 1 });
    let entered!: () => void; let release!: () => void;
    const locked = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const holding = external.begin(async connection => {
      await connection`select key from app_settings where key='tournament_visuals' for update`;
      entered(); await gate;
    });
    await locked;
    const pending = saveProfile("bounty", 195);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        const rows = await client`select count(*)::int as count from pg_stat_activity where datname=current_database() and wait_event_type='Lock'`;
        if (rows[0].count > 0) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally {
      release(); await holding; await external.end({ timeout: 3 });
    }
    expect((await pending).status).toBe(200);
    expect((await stored()).bounty.profile.scale).toBe(195);
  });
  it("E: Profile/List/Main resets and PNG upload preserve fields outside their documented scope", async () => {
    const original = await stored();
    expect((await profile.DELETE(command({ tournamentType: "bounty" }, "DELETE"))).status).toBe(200);
    let value = await stored(); const expected = structuredClone(original); delete expected.bounty.profile;
    expect(value).toEqual(expected);
    await seedValue(original);
    expect((await listReset.POST(command({ tournamentType: "bounty" }, "POST"))).status).toBe(200);
    value = await stored(); const withoutList = structuredClone(original); delete withoutList.bounty.list;
    expect(value).toEqual(withoutList);
    await seedValue(original);
    expect((await resets.POST(command({ tournamentType: "bounty" }, "POST"))).status).toBe(200);
    value = await stored();
    expect(value.bounty).toEqual({ ...getDefaultTournamentVisual("bounty"), profile: original.bounty.profile, extension: original.bounty.extension });
    await seedValue(original);
    const form = new FormData(); form.set("tournamentType", "bounty"); form.set("file", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "a.png", { type: "image/png" }));
    const request = new Request("http://isolated.test/upload", { method: "POST" });
    // jsdom's FormData/File belong to another realm than Node's multipart
    // parser. Supply the parsed form to the real route, with real File bytes.
    vi.spyOn(request, "formData").mockResolvedValue(form);
    expect((await upload.POST(request)).status).toBe(200);
    value = await stored();
    expect(value.bounty).toEqual({ ...original.bounty, assetUrl: expect.stringMatching(/^\/fixture\/new\//), cardAssetUrl: expect.stringMatching(/-card.png$/) });
  });
  it("keeps a Profile edit committed while a slower upload prepares its assets", async () => {
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    h.uploads.mockImplementationOnce(async (name: string) => { entered(); await gate; return `/fixture/new/${name}`; });
    const form = new FormData(); form.set("tournamentType", "bounty"); form.set("file", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "a.png", { type: "image/png" }));
    const request = new Request("http://isolated.test/upload", { method: "POST" }); vi.spyOn(request, "formData").mockResolvedValue(form);
    const pending = upload.POST(request); await started;
    expect((await saveProfile("bounty", 190)).status).toBe(200); release();
    expect((await pending).status).toBe(200);
    expect((await stored()).bounty).toMatchObject({ profile: { scale: 190 }, list: seed().bounty.list, assetUrl: expect.stringMatching(/^\/fixture\/new\//) });
  });
  it("concurrent resets preserve independently edited surfaces", async () => {
    expect((await Promise.all([
      profile.DELETE(command({ tournamentType: "bounty" }, "DELETE")), saveSurface("list", 160),
    ])).map(r => r.status)).toEqual([200, 200]);
    expect((await stored()).bounty.profile).toBeUndefined(); expect((await stored()).bounty.list.scale).toBe(160);
    expect((await Promise.all([
      resets.POST(command({ tournamentType: "bounty" }, "POST")), saveProfile("bounty", 190),
    ])).map(r => r.status)).toEqual([200, 200]);
    expect((await stored()).bounty).toEqual({ ...getDefaultTournamentVisual("bounty"), extension: seed().bounty.extension, profile: { ...geometry, scale: 190 } });
  });
  it("F: missing-row concurrent initialization writes only requested entries, not eleven defaults", async () => {
    await client`delete from app_settings`;
    expect(await repo.get("tournament_visuals")).toBeNull();
    expect((await Promise.all([saveProfile("bounty"), saveProfile("classic")])).map(r => r.status)).toEqual([200, 200]);
    expect(Object.keys(await stored()).sort()).toEqual(["bounty", "classic"]);
    expect((await stored()).bounty.profile.scale).toBe(175);
    expect((await stored()).classic.profile.scale).toBe(175);
  });
  it("rolls back missing-row initialization after a failed read", async () => {
    await client`delete from app_settings`; h.fault = "read";
    expect((await saveProfile("bounty")).status).toBe(500);
    expect(await stored()).toBeUndefined();
  });
  it.each([null, "broken", [], { bounty: null }, { bounty: { assetUrl: 22 } }, { bounty: { profile: { scale: "bad" } } }].map(value => [value]))("F: corrupted JSON %s fails closed and remains unchanged", async value => {
    await seedValue(value);
    expect((await main.GET()).status).toBe(500);
    expect((await saveProfile("classic")).status).toBe(500);
    expect(await stored()).toEqual(value);
  });
  it("returns validation 400 / retryable DB conflict 409, never raw diagnostics", async () => {
    expect((await profile.PUT(command({ tournamentType: "bounty", geometry: { ...geometry, scale: 400 } }))).status).toBe(400);
    expect((await main.PUT(command(seed().bounty))).status).toBe(400);
    h.fault = "conflict";
    const response = await saveProfile("bounty"); expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("secret");
  });
});
