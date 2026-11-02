import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { avatarStorageRepository, contentTypeToExtension, playerRepository } from "@/lib/repositories";
import { AvatarForbiddenOriginError, resolvePlayerAvatarActor } from "@/lib/player-avatar-auth";
import {
  hasValidPlayerAvatarSignature,
  MAX_PLAYER_AVATAR_SIZE_BYTES,
  PLAYER_AVATAR_CONTENT_TYPES,
} from "@/lib/player-avatar-file";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: playerId } = await context.params;
    const actor = await resolvePlayerAvatarActor(request);

    if (!actor) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    if (actor.id !== playerId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (actor.is_blocked) {
      return NextResponse.json({ error: "Аккаунт заблокирован администратором" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "File is required" }, { status: 400 });
    if (!PLAYER_AVATAR_CONTENT_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Поддерживаются только JPEG, PNG и WebP" }, { status: 400 });
    }
    if (file.size > MAX_PLAYER_AVATAR_SIZE_BYTES) {
      return NextResponse.json({ error: "Файл слишком большой. Максимум 20 МБ" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    if (!hasValidPlayerAvatarSignature(file.type, bytes)) {
      return NextResponse.json({ error: "Некорректный файл изображения" }, { status: 400 });
    }

    const filePath = `${actor.id}/avatar-${randomUUID()}.${contentTypeToExtension(file.type)}`;
    const { error: uploadError } = await avatarStorageRepository.upload(filePath, bytes, file.type);
    if (uploadError) {
      console.error("Avatar storage upload failed", uploadError);
      return NextResponse.json({ error: "Не удалось сохранить аватар" }, { status: 500 });
    }

    const publicUrl = avatarStorageRepository.getPublicUrl(filePath);
    const versionedUrl = `${publicUrl}?v=${Date.now()}`;
    try {
      const updatedPlayer = await playerRepository.update(actor.id, {
        custom_avatar_url: versionedUrl,
        avatar_updated_at: new Date().toISOString(),
      });
      return NextResponse.json({ player: updatedPlayer });
    } catch (error) {
      console.error("Avatar player update failed", error);
      return NextResponse.json({ error: "Не удалось обновить профиль" }, { status: 500 });
    }
  } catch (error) {
    if (error instanceof AvatarForbiddenOriginError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Avatar upload route error:", error);
    return NextResponse.json({ error: "Не удалось загрузить аватар" }, { status: 500 });
  }
}
