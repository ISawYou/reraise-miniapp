import { beforeEach, describe, expect, it, vi } from "vitest";
import { TARGET_ID, routeContext } from "@/lib/__tests__/helpers/follows-fixtures";

// GET /api/players/[id]/followers -- public. next/headers is rigged to THROW,
// so a green run also proves the route never asks for the viewer's identity.

const mocks = vi.hoisted(() => ({
  listFollowers: vi.fn(),
  countFollowers: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: {},
  followRepository: { listFollowers: mocks.listFollowers, countFollowers: mocks.countFollowers },
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    throw new Error("public route must not read request identity");
  },
  cookies: async () => {
    throw new Error("public route must not read request identity");
  },
}));

const { GET } = await import("@/app/api/players/[id]/followers/route");

function get(id: string, query = "") {
  return GET(new Request(`http://localhost/api/players/${id}/followers${query}`), routeContext(id));
}

const row = {
  id: "44444444-4444-4444-8444-444444444444",
  display_name: "Alex",
  telegram_avatar_url: "https://example.com/tg.png",
  custom_avatar_url: null,
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.listFollowers.mockReset().mockResolvedValue([row]);
  mocks.countFollowers.mockReset().mockResolvedValue(1);
});

describe("GET /api/players/[id]/followers", () => {
  it("200 { items, total } for an anonymous caller, with the default page (50, 0)", async () => {
    const response = await get(TARGET_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [row], total: 1 });
    expect(mocks.listFollowers).toHaveBeenCalledWith(TARGET_ID, 50, 0);
    expect(mocks.countFollowers).toHaveBeenCalledWith(TARGET_ID);
  });

  it("passes limit/offset through and clamps limit to 1..100", async () => {
    await get(TARGET_ID, "?limit=20&offset=40");
    expect(mocks.listFollowers).toHaveBeenLastCalledWith(TARGET_ID, 20, 40);

    await get(TARGET_ID, "?limit=5000");
    expect(mocks.listFollowers).toHaveBeenLastCalledWith(TARGET_ID, 100, 0);

    await get(TARGET_ID, "?limit=0");
    expect(mocks.listFollowers).toHaveBeenLastCalledWith(TARGET_ID, 1, 0);
  });

  it("malformed limit/offset fall back to the defaults instead of erroring", async () => {
    for (const query of ["?limit=abc&offset=xyz", "?limit=-5&offset=-1", "?limit=2.5&offset=1.5", "?limit=&offset=", "?limit=1e3"]) {
      const response = await get(TARGET_ID, query);

      expect(response.status).toBe(200);
      expect(mocks.listFollowers).toHaveBeenLastCalledWith(TARGET_ID, 50, 0);
    }
  });

  it("items contain ONLY id/display_name/telegram_avatar_url/custom_avatar_url (no username)", async () => {
    mocks.listFollowers.mockResolvedValue([
      { ...row, username: "secret_handle", email: "secret@example.com", telegram_id: 42 },
    ]);

    const body = await (await get(TARGET_ID)).json();

    expect(Object.keys(body.items[0]).sort()).toEqual([
      "custom_avatar_url",
      "display_name",
      "id",
      "telegram_avatar_url",
    ]);
    expect(JSON.stringify(body)).not.toMatch(/username|secret|email|telegram_id/);
  });

  it("an unknown but well-formed player id gives an empty page, not 404", async () => {
    mocks.listFollowers.mockResolvedValue([]);
    mocks.countFollowers.mockResolvedValue(0);

    const response = await get("99999999-9999-4999-8999-999999999999");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], total: 0 });
  });

  it("400 Некорректный идентификатор игрока for a malformed id, without touching the repository", async () => {
    const response = await get("not-a-uuid");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Некорректный идентификатор игрока" });
    expect(mocks.listFollowers).not.toHaveBeenCalled();
  });

  it("500 with the fixed list message; raw DB text never reaches the client", async () => {
    mocks.listFollowers.mockRejectedValue(new Error("invalid input syntax for type uuid: relation follows"));

    const response = await get(TARGET_ID);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Не удалось загрузить список. Попробуйте ещё раз." });
  });
});
