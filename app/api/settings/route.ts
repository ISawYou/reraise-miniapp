import { NextResponse } from "next/server";
import { getAppSetting } from "@/lib/app-settings";

// Public endpoint — returns client-facing feature flags
export async function GET() {
  try {
    const [emailLinkPrompt, includeAdminActivity] = await Promise.all([
      getAppSetting("show_email_link_prompt"),
      getAppSetting("include_admin_activity"),
    ]);
    return NextResponse.json({
      show_email_link_prompt: emailLinkPrompt === true,
      include_admin_activity: includeAdminActivity === true,
    });
  } catch (error) {
    console.error("[settings] GET error:", error);
    return NextResponse.json({ show_email_link_prompt: false, include_admin_activity: false });
  }
}
