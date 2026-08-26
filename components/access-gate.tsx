"use client";

import { useEffect, useState, type ReactNode } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { BlockedScreen } from "@/components/blocked-screen";

type AccessGateProps = {
  children: ReactNode;
};

// Root-level gate, wrapping every route (see app/layout.tsx). This is the
// single place that turns "the current player is blocked" into "don't show
// the app" -- every page in this app resolves its player through either
// resolveCurrentPlayer() or a route-local session check, and every one of
// those already re-reads the player row (with is_blocked) from the DB per
// request, so this only has to react to what they already fetch.
//
// Renders children immediately (no app-wide loading spinner for the common
// case) and swaps to BlockedScreen once resolution confirms is_blocked.
// This is a UX layer, not the security boundary -- actual enforcement lives
// server-side in features/auth-server.ts (getPlayerFromSessionServer,
// assertPlayerActive), which a blocked player cannot bypass by skipping
// past this gate.
export function AccessGate({ children }: AccessGateProps) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    resolveCurrentPlayer()
      .then((player) => {
        if (!cancelled && player.is_blocked) {
          setBlocked(true);
        }
      })
      .catch(() => {
        // Not logged in / anonymous visitor -- not this gate's concern,
        // each page already handles its own login flow.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (blocked) {
    return <BlockedScreen />;
  }

  return <>{children}</>;
}
