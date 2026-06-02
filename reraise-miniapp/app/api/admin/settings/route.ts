import { type NextRequest, NextResponse } from "next/server";
import { setAppSetting } from "@/lib/app-settings";

// Admin-only write — middleware already verified initData + admin role for /api/admin/*
export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as { show_email_link_prompt?: boolean };
    if (typeof body.show_email_link_prompt !== "boolean") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    await setAppSetting("show_email_link_prompt", body.show_email_link_prompt);
    return NextResponse.json({ ok: true, show_email_link_prompt: body.show_email_link_prompt });
  } catch (error) {
    console.error("[settings] PATCH error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
