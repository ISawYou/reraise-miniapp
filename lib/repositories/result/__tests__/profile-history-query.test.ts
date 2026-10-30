import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { db: drizzle(async (sql, params) => { m.query(sql, params); return { rows: [] }; }) };
});
const { PostgresResultRepository } = await import("../PostgresResultRepository");
const repo = new PostgresResultRepository();
beforeEach(() => vi.clearAllMocks());

it("applies completed status, stable tournament ordering and database-side limit/offset", async () => {
  await repo.findHistoryWithTournamentByPlayerId("player", { limit: 21, offset: 60 });
  const [sql, params] = m.query.mock.calls[0];
  expect(sql).toContain('"tournaments"."status" =');
  expect(sql).toContain('order by "tournaments"."start_at" desc, "tournaments"."id" desc');
  expect(sql).toContain('limit');
  expect(sql).toContain('offset');
  expect(params).toEqual(["player", "completed", 21, 60]);
});

it("preserves legacy unpaged callers without a completed-status filter", async () => {
  await repo.findHistoryWithTournamentByPlayerId("player");
  const [sql, params] = m.query.mock.calls[0];
  expect(sql).toContain('order by "results"."created_at" desc');
  expect(sql).not.toContain('limit');
  expect(params).toEqual(["player"]);
});

it("aggregates the original all-time knockout facts without loading historical rows", async () => {
  await repo.sumHistoryKnockoutsByPlayerId("player");
  const [sql, params] = m.query.mock.calls[0];
  expect(sql).toContain('sum("results"."knockouts")');
  expect(sql).not.toContain('"tournaments"."status" =');
  expect(params).toEqual(["player"]);
});
