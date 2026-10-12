import { type NextRequest, NextResponse } from "next/server";
import { uploadClubActivityImage } from "@/features/club-activity-media";
import { ClubActivityImageError } from "@/lib/club-activity-image";
import {
  CLUB_ACTIVITY_IMAGE_MAX_BYTES,
  CLUB_ACTIVITY_IMAGE_MESSAGES,
} from "@/lib/club-activity-image-limits";

// Authorization: this route lives under /api/admin/**, so middleware.ts
// (resolveAuthenticatedCaller + lib/admin-permissions.ts) has already
// admitted only a Super Admin before this handler runs -- the exact same
// gate as the sibling create/edit/archive routes in this folder. It is
// deliberately NOT on the operator allowlist (neither are those siblings).

// Room for multipart boundaries/headers around a max-size file.
const MAX_REQUEST_BYTES = CLUB_ACTIVITY_IMAGE_MAX_BYTES + 64 * 1024;

const STATUS_BY_CODE: Record<ClubActivityImageError["code"], number> = {
  empty: 400,
  too_large: 413,
  unsupported_type: 415,
  heic: 415,
  not_image: 422,
  too_many_pixels: 422,
  processing_failed: 422,
};

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: CLUB_ACTIVITY_IMAGE_MESSAGES.too_large }, { status: 413 });
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать файл. Попробуйте выбрать его ещё раз" },
      { status: 400 },
    );
  }
  // FormDataEntryValue is File | string; anything but a file part is refused.
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Выберите файл изображения" }, { status: 400 });
  }

  try {
    return NextResponse.json(await uploadClubActivityImage(file), { status: 201 });
  } catch (error) {
    if (error instanceof ClubActivityImageError) {
      return NextResponse.json({ error: error.message }, { status: STATUS_BY_CODE[error.code] });
    }
    // Message only -- never the request, file bytes, headers or initData.
    console.error(
      "[POST /api/admin/club-activity/media] error:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json({ error: "Не удалось сохранить изображение" }, { status: 500 });
  }
}
