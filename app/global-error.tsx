"use client";

import { useEffect } from "react";
import { BootRecoveryScreen } from "@/components/boot-recovery-screen";
import { logEvent } from "@/lib/activity-client";

// Next.js requires this to render its own <html>/<body> -- it replaces the
// root layout entirely when an error escapes app/error.tsx (e.g. a crash in
// app/layout.tsx itself). Deliberately dependency-light: only the tiny
// presentational BootRecoveryScreen and the existing best-effort activity
// logger, nothing that touches data fetching, repositories, or auth, so
// this stays renderable even when the rest of the app failed to load.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      logEvent("client_global_error", {
        metadata: {
          source: "global_error_boundary",
          error_name: error?.name ?? "Error",
          error_message: (error?.message ?? "").slice(0, 300),
          digest: error?.digest ?? null,
          phase: "global_error",
        },
      });
    } catch {}
  }, [error]);

  return (
    <html lang="ru">
      <body className="bg-black">
        <BootRecoveryScreen
          title="Не удалось загрузить приложение"
          description="Попробуйте загрузить ещё раз."
          primaryLabel="Повторить"
          onPrimary={reset}
          secondaryLabel="Перезагрузить приложение"
          onSecondary={() => window.location.reload()}
          helperText="Если проблема повторится, закройте Mini App и перезапустите Telegram."
        />
      </body>
    </html>
  );
}
