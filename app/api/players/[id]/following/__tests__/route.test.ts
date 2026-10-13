import { beforeEach, describe, expect, it, vi } from "vitest";
import { TARGET_ID, routeContext } from "@/lib/__tests__/helpers/follows-fixtures";

// GET /api/players/[id]/following -- public. next/headers is rigged to THROW,
// so a green run also proves the route never asks for the viewer's identity.

const mocks = vi.hoisted(() => ({
  listFollowing: vi.fn(),
  countFollowing: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: {},
  followRepository: { listFollowing: mocks.listFollowing, countFollowing: mocks.countFollowing },
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    throw new Error("public route must not read request identity");
  },
  cookies: async () => {
    throw new Error("public route must not read request identity");
  },
}));

const { GET } = await import("@/app/api/players/[id]/following/route");

function get(id: string, query = "") {
  return GET(new Request(`http://localhost/api/players/${id}/following${query}`), routeContext(id));
}

const row = {
  id: "55555555-5555-4555-8555-555555555555",
  display_name: "Boris",
  telegram_avatar_url: null,
  custom_avatar_url: "https://example.com/custom.png",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.listFollowing.mockReset().mockResolvedValue([row]);
  mocks.countFollowing.mockReset().mockResolvedValue(1);
});

describe("GET /api/players/[id]/following", () => {
  it("200 { items, total } for an anonymous caller, with the default page (50, 0)", async () => {
    const response = await get(TARGET_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [row], total: 1 });
    expect(mocks.listFollowing).toHaveBeenCalledWith(TARGET_ID, 50, 0);
    expect(mocks.countFollowing).toHaveBeenCalledWith(TARGET_ID);
  });

  it("passes limit/offset through and clamps limit to 1..100", async () => {
    await get(TARGET_ID, "?limit=30&offset=60");
    expect(mocks.listFollowing).toHaveBeenLastCalledWith(TARGET_ID, 30, 60);

    await get(TARGET_ID, "?limit=101");
    expect(mocks.listFollowing).toHaveBeenLastCalledWith(TARGET_ID, 100, 0);
  });

  it("malformed limit/offset fall back to the defaults instead of erroring", async () => {
    for (const query of ["?limit=abc&offset=xyz", "?limit=-5&offset=-1", "?limit=NaN&offset=Infinity"]) {
      const response = await get(TARGET_ID, query);

      expect(response.status).toBe(200);
      expect(mocks.listFollowing).toHaveBeenLastCalledWith(TARGET_ID, 50, 0);
    }
  });

  it("items contain ONLY id/display_name/telegram_avatar_url/custom_avatar_url (no username)", async () => {
    mocks.listFollowing.mockResolvedValue([{ ...row, username: "secret_handle", email: "secret@example.com" }]);

    const body = await (await get(TARGET_ID)).json();

    expect(Object.keys(body.items[0]).sort()).toEqual([
      "custom_avatar_url",
      "display_name",
      "id",
      "telegram_avatar_url",
    ]);
    expect(JSON.stringify(body)).not.toMatch(/username|secret|email/);
  });

  it("an unknown but well-formed player id gives an empty page, not 404", async () => {
    mocks.listFollowing.mockResolvedValue([]);
    mocks.countFollowing.mockResolvedValue(0);

    const response = await get("99999999-9999-4999-8999-999999999999");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], total: 0 });
  });

  it("400 Некорректный идентификатор игрока for a malformed id, without touching the repository", async () => {
    const response = await get("not-a-uuid");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Некорректный идентификатор игрока" });
    expect(mocks.listFollowing).not.toHaveBeenCalled();
  });

  it("500 with the fixed list message; raw DB text never reaches the client", async () => {
    mocks.listFollowing.mockRejectedValue(new Error("deadlock detected"));

    const response = await get(TARGET_ID);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Не удалось загрузить список. Попробуйте ещё раз." });
  });
});
