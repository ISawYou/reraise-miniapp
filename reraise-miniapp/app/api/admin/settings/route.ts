import { type NextRequest, NextResponse } from "next/server";
import { setAppSetting } from "@/lib/app-settings";

// Admin-only write — middleware already verified initData + admin role for /api/admin/*
export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      show_email_link_prompt?: boolean;
      include_admin_activity?: boolean;
    };

    if (typeof body.show_email_link_prompt === "boolean") {
      await setAppSetting("show_email_link_prompt", body.show_email_link_prompt);
    }

    if (typeof body.include_admin_activity === "boolean") {
      await setAppSetting("include_admin_activity", body.include_admin_activity);
    }

    if (
      typeof body.show_email_link_prompt !== "boolean" &&
      typeof body.include_admin_activity !== "boolean"
    ) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[settings] PATCH error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
