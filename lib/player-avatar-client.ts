import { fetchAdminJson } from "@/lib/client-request";
import type { Player } from "@/types/domain";

export async function uploadPlayerAvatar(playerId: string, file: File): Promise<Player> {
  const formData = new FormData();
  formData.append("file", file);

  const payload = await fetchAdminJson<{ player: Player }>(
    `/api/players/${playerId}/avatar`,
    { method: "POST", body: formData, credentials: "include" },
    { retries: 0 }
  );
  return payload.player;
}
