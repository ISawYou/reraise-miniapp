"use client";

import { useRef, useState } from "react";
import {
  CLUB_ACTIVITY_IMAGE_ACCEPT_ATTRIBUTE,
  getClubActivityImageClientError,
} from "@/lib/club-activity-image-limits";

/** A locally selected file that is NOT uploaded yet (uploaded on Save). */
export type PendingClubActivityImage = { file: File; previewUrl: string };

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

// Admin-only image control for /admin/news. Upload is the primary path; the
// external-URL input stays available behind "Или вставить ссылку". The
// parent owns the pending file (and its object URL lifetime) because only
// Save decides when it is uploaded.
export function ClubActivityImageField({
  imageUrl,
  onImageUrlChange,
  pendingImage,
  onPendingImageChange,
  disabled = false,
  inputClassName,
}: {
  imageUrl: string;
  onImageUrlChange: (url: string) => void;
  pendingImage: PendingClubActivityImage | null;
  onPendingImageChange: (next: PendingClubActivityImage | null) => void;
  disabled?: boolean;
  inputClassName: string;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(false);

  const previewSrc = pendingImage?.previewUrl ?? (imageUrl.trim() || null);

  function openPicker() {
    fileInputRef.current?.click();
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    // Allow picking the same file again after removing it.
    event.target.value = "";
    if (!file) return;
    const clientError = getClubActivityImageClientError(file);
    if (clientError) {
      setFileError(clientError);
      return;
    }
    setFileError(null);
    setShowUrlInput(false);
    onPendingImageChange({ file, previewUrl: URL.createObjectURL(file) });
  }

  function removeImage() {
    setFileError(null);
    onPendingImageChange(null);
    onImageUrlChange("");
  }

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
      <p className="text-xs text-white/50">Изображение</p>

      <input
        ref={fileInputRef}
        type="file"
        accept={CLUB_ACTIVITY_IMAGE_ACCEPT_ATTRIBUTE}
        onChange={handleFileChange}
        className="hidden"
        aria-label="Файл изображения"
        data-testid="club-activity-image-input"
      />

      {previewSrc ? (
        <div className="mt-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewSrc}
            alt="Предпросмотр изображения"
            width={1280}
            height={720}
            decoding="async"
            className="block aspect-[16/9] h-auto w-full rounded-xl border border-white/10 bg-white/[0.04] object-cover"
          />
          <p className="mt-2 truncate text-xs text-white/55" data-testid="club-activity-image-state">
            {pendingImage
              ? `${pendingImage.file.name} · ${formatFileSize(pendingImage.file.size)} · загрузится при сохранении`
              : "Текущее изображение"}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={openPicker}
              className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              Заменить
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={removeImage}
              className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 disabled:opacity-50"
            >
              Удалить изображение
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={openPicker}
          className="mt-2 w-full rounded-xl border border-dashed border-[#d7b55a]/35 bg-[#d7b55a]/[0.06] px-3 py-4 text-sm font-semibold text-[#e2c979] disabled:opacity-50"
        >
          Загрузить изображение
          <span className="mt-1 block text-[11px] font-normal text-white/40">
            JPEG, PNG или WebP · до 8 МБ · с телефона или компьютера
          </span>
        </button>
      )}

      {fileError ? <p className="mt-2 text-xs text-red-300" role="alert">{fileError}</p> : null}

      {showUrlInput ? (
        <label className="mt-3 block text-xs text-white/50">
          Ссылка на изображение
          <input
            type="url"
            value={pendingImage ? "" : imageUrl}
            onChange={(event) => {
              // Typing a link replaces a not-yet-uploaded local file.
              if (pendingImage) onPendingImageChange(null);
              onImageUrlChange(event.target.value);
            }}
            placeholder="https://..."
            className={inputClassName}
          />
        </label>
      ) : (
        <button
          type="button"
          onClick={() => setShowUrlInput(true)}
          className="mt-2 text-xs text-white/45 underline-offset-2 hover:underline"
        >
          Или вставить ссылку
        </button>
      )}
    </div>
  );
}
