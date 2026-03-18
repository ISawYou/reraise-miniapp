export type AvatarSource = {
  display_name?: string | null;
  custom_avatar_url?: string | null;
  telegram_avatar_url?: string | null;
};

export function getPlayerAvatarUrl(player: AvatarSource | null | undefined) {
  if (!player) {
    return null;
  }

  return player.custom_avatar_url ?? player.telegram_avatar_url ?? null;
}

export function getPlayerAvatarFallback(player: AvatarSource | null | undefined) {
  const displayName = player?.display_name?.trim();
  return displayName ? displayName[0].toUpperCase() : "?";
}
