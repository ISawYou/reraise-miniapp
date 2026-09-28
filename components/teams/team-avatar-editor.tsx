"use client";

import { useRef, useState } from "react";
import { fetchAdminJson } from "@/lib/client-request";
import { TeamIdentity, type TeamIdentityLike } from "./team-ui";

export type TeamAvatarEditorTeam = TeamIdentityLike & { id: string };

// THE one shared client-side implementation of captain photo upload/
// replace/reset, talking directly to the existing POST/DELETE
// /api/teams/[id]/avatar (auth is resolved server-side via
// resolveTeamsActor(), so this never sends a captain/player id itself,
// only the file). Used both by the team's own /teams/[id] captain view and
// by /teams -> Моя команда -> "Изменить команду", so there is exactly one
// upload/validation/error-handling implementation to keep in sync.
export function TeamAvatarEditor<T extends TeamAvatarEditorTeam>({
  team,
  onUpdated,
  showPreview = false,
  previewClassName = "h-10 w-10 text-lg",
  helperText,
}: {
  team: T;
  onUpdated: (team: T) => void;
  showPreview?: boolean;
  previewClassName?: string;
  helperText?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      setBusy(true);
      setError(null);
      const formData = new FormData();
      formData.append("file", file);
      const data = await fetchAdminJson<{ team: T }>(`/api/teams/${team.id}/avatar`, {
        method: "POST",
        body: formData,
      });
      onUpdated(data.team);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить фото");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    try {
      setBusy(true);
      setError(null);
      const data = await fetchAdminJson<{ team: T }>(`/api/teams/${team.id}/avatar`, {
        method: "DELETE",
      });
      onUpdated(data.team);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить фото");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {showPreview ? <TeamIdentity team={team} className={previewClassName} /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80 disabled:opacity-50"
          >
            {busy ? "Загружаем..." : team.avatar_url ? "Изменить фото" : "Загрузить фото"}
          </button>
          {team.avatar_url ? (
            <button
              type="button"
              disabled={busy}
              onClick={handleDelete}
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/60 disabled:opacity-50"
            >
              Удалить фото
            </button>
          ) : null}
        </div>
        {helperText ? <p className="text-xs text-white/45">{helperText}</p> : null}
        {error ? <p className="text-xs text-red-300">{error}</p> : null}
      </div>
    </div>
  );
}
