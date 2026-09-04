"use client";

import { useEffect } from "react";
import { BootRecoveryScreen } from "@/components/boot-recovery-screen";
import { logEvent } from "@/lib/activity-client";

// App Router route error boundary -- catches an uncaught render/effect
// exception in this route segment and shows a recovery screen instead of
// leaving the user on a blank surface. See app/global-error.tsx for the
// equivalent when the error escapes the root layout itself.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Best-effort only -- logEvent already no-ops before identity is
    // established and never throws internally, but this screen's only job
    // is to stay up, so nothing here may risk it.
    try {
      logEvent("client_route_error", {
        metadata: {
          source: "route_error_boundary",
          error_name: error?.name ?? "Error",
          error_message: (error?.message ?? "").slice(0, 300),
          digest: error?.digest ?? null,
          phase: "route_error",
        },
      });
    } catch {}
  }, [error]);

  return (
    <BootRecoveryScreen
      title="Не удалось загрузить приложение"
      description="Попробуйте загрузить ещё раз."
      primaryLabel="Повторить"
      onPrimary={reset}
      secondaryLabel="Перезагрузить приложение"
      onSecondary={() => window.location.reload()}
      helperText="Если проблема повторится, закройте Mini App и перезапустите Telegram."
    />
  );
}
