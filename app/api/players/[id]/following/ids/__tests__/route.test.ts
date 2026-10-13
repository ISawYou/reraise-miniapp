import { beforeEach, describe, expect, it, vi } from "vitest";
import { TARGET_ID, routeContext } from "@/lib/__tests__/helpers/follows-fixtures";

// GET /api/players/[id]/following/ids -- public and unbounded. next/headers
// is rigged to THROW, so a green run also proves the route never asks for the
// viewer's identity.

const mocks = vi.hoisted(() => ({
  listFollowingIds: vi.fn(),
  listFollowing: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: {},
  followRepository: { listFollowingIds: mocks.listFollowingIds, listFollowing: mocks.listFollowing },
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    throw new Error("public route must not read request identity");
  },
  cookies: async () => {
    throw new Error("public route must not read request identity");
  },
}));

const { GET } = await import("@/app/api/players/[id]/following/ids/route");

function get(id: string, query = "") {
  return GET(new Request(`http://localhost/api/players/${id}/following/ids${query}`), routeContext(id));
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.listFollowingIds.mockReset().mockResolvedValue([]);
  mocks.listFollowing.mockReset();
});

describe("GET /api/players/[id]/following/ids", () => {
  it("200 { ids } for an anonymous caller", async () => {
    mocks.listFollowingIds.mockResolvedValue(["a", "b"]);

    const response = await get(TARGET_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ids: ["a", "b"] });
    expect(mocks.listFollowingIds).toHaveBeenCalledWith(TARGET_ID);
  });

  it("returns every id with NO 50/100 page cap, and ignores limit/offset", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    mocks.listFollowingIds.mockResolvedValue(ids);

    const body = await (await get(TARGET_ID, "?limit=5&offset=10")).json();

    expect(body.ids).toHaveLength(450);
    expect(mocks.listFollowing).not.toHaveBeenCalled();
    expect(mocks.listFollowingIds).toHaveBeenCalledWith(TARGET_ID);
  });

  it("an unknown but well-formed player id gives { ids: [] }, not 404", async () => {
    const response = await get("99999999-9999-4999-8999-999999999999");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ids: [] });
  });

  it("400 Некорректный идентификатор игрока for a malformed id, without touching the repository", async () => {
    const response = await get("not-a-uuid");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Некорректный идентификатор игрока" });
    expect(mocks.listFollowingIds).not.toHaveBeenCalled();
  });

  it("500 with the fixed list message; raw DB text never reaches the client", async () => {
    mocks.listFollowingIds.mockRejectedValue(new Error("invalid input syntax for type uuid"));

    const response = await get(TARGET_ID);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Не удалось загрузить список. Попробуйте ещё раз." });
  });
});
