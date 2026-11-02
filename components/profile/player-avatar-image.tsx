"use client";

import { useState } from "react";
import { getPlayerAvatarFallback, getPlayerAvatarUrl, type AvatarSource } from "@/lib/player-avatar";

export function PlayerAvatarImage({ player }: { player: AvatarSource }) {
  const url = getPlayerAvatarUrl(player);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (url && failedUrl !== url) {
    return (
      <img
        src={url}
        alt={player.display_name ?? ""}
        onError={() => setFailedUrl(url)}
        className="h-[72px] w-[72px] rounded-full border border-white/10 object-cover"
      />
    );
  }

  return (
    <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-2xl font-bold text-white/80">
      {getPlayerAvatarFallback(player)}
    </div>
  );
}
