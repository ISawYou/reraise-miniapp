import { NextResponse } from "next/server";
import { getAppSetting } from "@/lib/app-settings";

// Public endpoint — returns client-facing feature flags
export async function GET() {
  try {
    const value = await getAppSetting("show_email_link_prompt");
    return NextResponse.json({ show_email_link_prompt: value === true });
  } catch (error) {
    console.error("[settings] GET error:", error);
    // Fail-safe: return false so the app keeps working if the table isn't created yet
    return NextResponse.json({ show_email_link_prompt: false });
  }
}
