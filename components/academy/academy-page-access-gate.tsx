import "server-only";

import type { ReactNode } from "react";
import { AcademyAccessPending, AcademyLockedScreen } from "@/components/academy/academy-locked-screen";
import type { AcademyAccessTarget } from "@/config/academy/access-policy";
import { checkAcademyRequestAccess } from "@/lib/academy/access-request";

/**
 * Server-side page gate (async SERVER component — never "use client").
 * `children` is rendered only when the request's canonical player is allowed
 * `target`; otherwise the server returns the locked screen (or a neutral
 * placeholder while no session exists yet) and the locked page's content is
 * never rendered or serialized into the response.
 */
export async function AcademyPageAccessGate({
  target,
  children,
}: {
  target: AcademyAccessTarget | readonly AcademyAccessTarget[];
  children: ReactNode;
}) {
  const decision = await checkAcademyRequestAccess(target);
  if (decision === "ALLOWED") return <>{children}</>;
  if (decision === "DENIED") return <AcademyLockedScreen />;
  return <AcademyAccessPending />;
}
