import { NextResponse } from "next/server";
import { updatePlayerAdminDisplayName } from "@/features/admin";
import { approveNickname, rejectNickname } from "@/features/auth";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      action?: "approve" | "reject" | "set_admin_display_name";
      admin_display_name?: string | null;
    };

    if (
      body.action !== "approve" &&
      body.action !== "reject" &&
      body.action !== "set_admin_display_name"
    ) {
      return NextResponse.json(
        { error: "Некорректное действие" },
        { status: 400 }
      );
    }

    const player =
      body.action === "approve"
        ? await approveNickname(id)
        : body.action === "reject"
          ? await rejectNickname(id)
          : await updatePlayerAdminDisplayName(id, body.admin_display_name ?? null);

    return NextResponse.json({ player });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось обработать ник",
      },
      { status: 500 }
    );
  }
}
