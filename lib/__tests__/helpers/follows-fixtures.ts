import { createHmac } from "crypto";
import type { Player } from "@/types/domain";

// Shared builders for the follow route/auth tests. Pure functions only --
// vi.mock/vi.hoisted must live in each test file itself.

export const BOT_TOKEN = "123456:follows-route-test-token";

export const VIEWER_ID = "11111111-1111-4111-8111-111111111111";
export const TARGET_ID = "22222222-2222-4222-8222-222222222222";
export const VICTIM_ID = "33333333-3333-4333-8333-333333333333";

export function player(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    telegram_id: null,
    username: null,
    display_name: id,
    role: "player",
    is_blocked: false,
    merged_into_player_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Player;
}

export function signInitData(telegramId: number, authDate: number, token = BOT_TOKEN): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "AAH-test",
    user: JSON.stringify({ id: telegramId, first_name: "Test" }),
  });
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(checkString).digest("hex"));
  return params.toString();
}

export const freshInitData = (telegramId: number) => signInitData(telegramId, Math.floor(Date.now() / 1000) - 60);
export const staleInitData = (telegramId: number) =>
  signInitData(telegramId, Math.floor(Date.now() / 1000) - 2 * 60 * 60);

export function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}
