import { NextResponse } from "next/server";
import { uploadTeamAvatar, resetTeamAvatar, InvalidTeamAvatarFileError } from "@/features/teams";
import { resolveTeamsActor } from "@/lib/teams-auth";
import { teamsErrorResponse } from "@/lib/teams-error-response";
import { createTeamAvatarDerivative } from "@/lib/team-avatar-derivative";

export const dynamic = "force-dynamic";

const ACCEPTED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_TEAM_AVATAR_SIZE_BYTES = 15 * 1024 * 1024;

// POST /api/teams/[id]/avatar -- captain-only upload/replace of the
// team's photo. Multipart form with a `file` field, mirroring
// app/api/players/[id]/avatar/route.ts's shape, but auth is resolved
// server-side via resolveTeamsActor() (Telegram initData header / session
// cookie) rather than a telegramInitData form field -- same convention as
// every other Teams API route, never a client-supplied captain id.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveTeamsActor();
    if (!actor) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }

    const { id: teamId } = await context.params;

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 400 });
    }

    if (!ACCEPTED_CONTENT_TYPES.has(file.type)) {
      throw new InvalidTeamAvatarFileError();
    }

    if (file.size > MAX_TEAM_AVATAR_SIZE_BYTES) {
      throw new InvalidTeamAvatarFileError("Файл слишком большой. Максимум 15 МБ");
    }

    const originalBytes = Buffer.from(await file.arrayBuffer());

    let processedBytes: Buffer;
    try {
      processedBytes = await createTeamAvatarDerivative(originalBytes);
    } catch {
      throw new InvalidTeamAvatarFileError("Не удалось обработать изображение");
    }

    const team = await uploadTeamAvatar(actor.id, teamId, processedBytes, "image/webp");
    return NextResponse.json({ team });
  } catch (error) {
    return teamsErrorResponse(error);
  }
}

// DELETE /api/teams/[id]/avatar -- captain-only reset back to the emblem
// (avatar_url -> null). No storage object deletion -- see
// features/teams.ts::resetTeamAvatar's doc comment.
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveTeamsActor();
    if (!actor) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }

    const { id: teamId } = await context.params;
    const team = await resetTeamAvatar(actor.id, teamId);
    return NextResponse.json({ team });
  } catch (error) {
    return teamsErrorResponse(error);
  }
}
