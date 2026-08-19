import { NextResponse } from "next/server";
import { getAppSetting } from "@/lib/app-settings";

// Public endpoint — returns client-facing feature flags
export async function GET() {
  try {
    const [emailLinkPrompt, includeAdminActivity, automaticAchievementsEnabled] = await Promise.all([
      getAppSetting("show_email_link_prompt"),
      getAppSetting("include_admin_activity"),
      getAppSetting("automatic_achievements_enabled"),
    ]);
    return NextResponse.json({
      show_email_link_prompt: emailLinkPrompt === true,
      include_admin_activity: includeAdminActivity === true,
      // Missing row / anything other than exactly `true` -> false. This is
      // the safe default for a first-ever deploy where the row doesn't
      // exist yet at all (see features/achievements.ts's
      // isAutomaticAchievementsEnabled, which applies the same rule
      // server-side for the actual write-path guard).
      automatic_achievements_enabled: automaticAchievementsEnabled === true,
    });
  } catch (error) {
    console.error("[settings] GET error:", error);
    return NextResponse.json({
      show_email_link_prompt: false,
      include_admin_activity: false,
      automatic_achievements_enabled: false,
    });
  }
}
