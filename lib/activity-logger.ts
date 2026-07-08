import "server-only";
import { activityRepository } from "@/lib/repositories";
import { getAppSetting } from "@/lib/app-settings";

export async function logActivityEvent({
  player_id,
  event_type,
  event_label,
  metadata,
  platform = "unknown",
  session_id,
  is_admin = false,
}: {
  player_id: string;
  event_type: string;
  event_label?: string;
  metadata?: Record<string, unknown>;
  platform?: string;
  session_id?: string;
  is_admin?: boolean;
}): Promise<void> {
  try {
    if (is_admin) {
      const includeAdmin = await getAppSetting("include_admin_activity");
      if (includeAdmin !== true) return;
    }

    await activityRepository.create({
      player_id,
      event_type,
      event_label: event_label ?? null,
      metadata: metadata ?? null,
      platform,
      session_id: session_id ?? null,
    });
  } catch (err) {
    console.error("[activity] logActivityEvent error:", err);
  }
}
