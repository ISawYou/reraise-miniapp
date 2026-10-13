import "server-only";

import { cookies } from "next/headers";
import {
  AcademyAccessDeniedError,
  assertAcademyAccess,
  type AcademyAccessTarget,
} from "@/features/academy-access";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

export type AcademyRequestAccessDecision = "UNAUTHENTICATED" | "ALLOWED" | "DENIED";

/**
 * Page-side counterpart of the API enforcement: the current request's
 * canonical player (session cookie → `getPlayerFromSessionServer`, so a
 * merged-away / blocked id is "no session") checked with the SAME
 * `assertAcademyAccess` call every Academy API route uses. Reading the
 * cookie makes the page dynamic — never a statically cached entitlement.
 */
export async function checkAcademyRequestAccess(
  targets: AcademyAccessTarget | readonly AcademyAccessTarget[],
): Promise<AcademyRequestAccessDecision> {
  const cookieStore = await cookies();
  const player = await getPlayerFromSessionServer(cookieStore.get(COOKIE_NAME)?.value);
  if (!player) return "UNAUTHENTICATED";
  try {
    await assertAcademyAccess(player, targets);
    return "ALLOWED";
  } catch (error) {
    if (error instanceof AcademyAccessDeniedError) return "DENIED";
    throw error;
  }
}
