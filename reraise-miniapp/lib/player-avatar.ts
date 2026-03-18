export type AvatarSource = {
  display_name?: string | null;
  custom_avatar_url?: string | null;
  telegram_avatar_url?: string | null;
};

function isTelegramPlaceholderAvatar(url: string) {
  return /^https:\/\/t\.me\/i\/userpic\//i.test(url);
}

export function getPlayerAvatarUrl(player: AvatarSource | null | undefined) {
  if (!player) {
    return null;
  }

  if (player.custom_avatar_url) {
    return player.custom_avatar_url;
  }

  if (
    player.telegram_avatar_url &&
    !isTelegramPlaceholderAvatar(player.telegram_avatar_url)
  ) {
    return player.telegram_avatar_url;
  }

  return null;
}

export function getPlayerAvatarFallback(player: AvatarSource | null | undefined) {
  const displayName = player?.display_name?.trim();
  return displayName ? displayName[0].toUpperCase() : "?";
}
