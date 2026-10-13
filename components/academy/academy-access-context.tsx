"use client";

import { createContext, useContext } from "react";
import type { AcademyAccessView } from "@/config/academy/access-copy";

/**
 * The player's Academy tier as resolved by `GET /api/academy/access`,
 * provided by `AcademyAuthGate` (re-checked on every Academy navigation).
 * PRESENTATION ONLY — it decides which cards look locked and which links are
 * offered; every page and API enforces access on the server regardless.
 * `null` outside the gate (isolated component tests): components then
 * render their unchanged full-access presentation.
 */
const AcademyAccessContext = createContext<AcademyAccessView | null>(null);

export const AcademyAccessProvider = AcademyAccessContext.Provider;

export function useAcademyAccess(): AcademyAccessView | null {
  return useContext(AcademyAccessContext);
}

/** True only when the server said BEGINNER_ONLY. */
export function useAcademyBeginnerOnly(): boolean {
  return useAcademyAccess()?.access === "BEGINNER_ONLY";
}
