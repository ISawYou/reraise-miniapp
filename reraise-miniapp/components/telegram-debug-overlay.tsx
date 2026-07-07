"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { getTelegramWebApp, isTelegramMiniAppContext } from "@/lib/telegram";

export const TG_DEBUG_STORAGE_KEY = "tgDebugOverlay";
export const TG_DEBUG_TOGGLE_EVENT = "tgDebugOverlayToggled";

type DebugState = {
  pathname: string;
  isTgContext: boolean;
  hasTgWebApp: boolean;
  platform: string;
  version: string;
  isExpanded: string;
  isFullscreen: string;
  isVerticalSwipesEnabled: string;
  viewportHeight: string;
  viewportStableHeight: string;
  safeTop: string;
  safeRight: string;
  safeBottom: string;
  safeLeft: string;
  contentTop: string;
  contentRight: string;
  contentBottom: string;
  contentLeft: string;
  safeSum: string;
  cssOffset: string;
  containerPaddingTop: string;
  lastSafe: string;
  lastContent: string;
  lastViewport: string;
};

type EventLog = { ts: string; event: string; detail?: string };

function now() {
  return new Date().toLocaleTimeString("ru-RU", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

function str(v: unknown): string {
  if (v === undefined || v === null) return "–";
  return String(v);
}

function readState(
  pathname: string,
  lastSafe: string,
  lastContent: string,
  lastViewport: string
): DebugState {
  const webApp = getTelegramWebApp();
  const wa = webApp as (typeof webApp & {
    platform?: string;
    version?: string;
    isExpanded?: boolean;
    isFullscreen?: boolean;
    isVerticalSwipesEnabled?: boolean;
    viewportHeight?: number;
    viewportStableHeight?: number;
  }) | null;

  const root = typeof document !== "undefined" ? document.documentElement : null;
  const container = typeof document !== "undefined"
    ? (document.querySelector(".telegram-app-safe-area") as HTMLElement | null)
    : null;

  const cssOffset = root
    ? (root.style.getPropertyValue("--app-top-offset") ||
       getComputedStyle(root).getPropertyValue("--app-top-offset") ||
       "–").trim()
    : "–";
  const containerPaddingTop = container
    ? window.getComputedStyle(container).paddingTop
    : "–";

  const safeTop = webApp?.safeAreaInset?.top;
  const contentTop = webApp?.contentSafeAreaInset?.top;
  const safeSum =
    typeof safeTop === "number" && typeof contentTop === "number"
      ? String(safeTop + contentTop)
      : "–";

  return {
    pathname,
    isTgContext: isTelegramMiniAppContext(),
    hasTgWebApp: Boolean(webApp),
    platform: str(wa?.platform),
    version: str(wa?.version),
    isExpanded: str(wa?.isExpanded),
    isFullscreen: str(wa?.isFullscreen),
    isVerticalSwipesEnabled: str(wa?.isVerticalSwipesEnabled),
    viewportHeight: str(wa?.viewportHeight),
    viewportStableHeight: str(wa?.viewportStableHeight),
    safeTop: str(safeTop),
    safeRight: str(webApp?.safeAreaInset?.right),
    safeBottom: str(webApp?.safeAreaInset?.bottom),
    safeLeft: str(webApp?.safeAreaInset?.left),
    contentTop: str(contentTop),
    contentRight: str(webApp?.contentSafeAreaInset?.right),
    contentBottom: str(webApp?.contentSafeAreaInset?.bottom),
    contentLeft: str(webApp?.contentSafeAreaInset?.left),
    safeSum,
    cssOffset,
    containerPaddingTop,
    lastSafe,
    lastContent,
    lastViewport,
  };
}

function isEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).has("debugTg")) return true;
    return localStorage.getItem(TG_DEBUG_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function TelegramDebugOverlay() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<DebugState | null>(null);
  const [logs, setLogs] = useState<EventLog[]>([]);
  const [copied, setCopied] = useState(false);

  const lastSafeRef = useRef("–");
  const lastContentRef = useRef("–");
  const lastViewportRef = useRef("–");

  const addLog = useCallback((event: string, detail?: string) => {
    const entry: EventLog = { ts: now(), event, detail };
    console.log(`[tg-debug] ${event}`, detail ?? "");
    setLogs(prev => [entry, ...prev].slice(0, 30));
  }, []);

  const refresh = useCallback((currentPathname: string) => {
    const s = readState(
      currentPathname,
      lastSafeRef.current,
      lastContentRef.current,
      lastViewportRef.current
    );
    setState(s);
  }, []);

  // Visibility: controlled by localStorage + custom event + URL param
  useEffect(() => {
    const check = () => {
      const enabled = isEnabled();
      setVisible(enabled);
      if (enabled) {
        addLog("OVERLAY ON");
        refresh(pathname);
      }
    };
    check();

    const onToggle = () => check();
    // cross-tab
    const onStorage = (e: StorageEvent) => {
      if (e.key === TG_DEBUG_STORAGE_KEY) check();
    };
    window.addEventListener(TG_DEBUG_TOGGLE_EVENT, onToggle);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(TG_DEBUG_TOGGLE_EVENT, onToggle);
      window.removeEventListener("storage", onStorage);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Route change
  const prevPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    if (prevPathRef.current !== null && prevPathRef.current !== pathname) {
      addLog("ROUTE CHANGE", `${prevPathRef.current} → ${pathname}`);
    }
    prevPathRef.current = pathname;
    refresh(pathname);
  }, [pathname, visible, addLog, refresh]);

  // Telegram event subscriptions
  useEffect(() => {
    if (!visible) return;
    const webApp = getTelegramWebApp();
    if (!webApp || typeof webApp.onEvent !== "function") return;

    const onSafe = () => {
      lastSafeRef.current = now();
      addLog("safeAreaChanged", `top=${webApp.safeAreaInset?.top ?? "?"}`);
      setTimeout(() => refresh(pathname), 35);
    };
    const onContent = () => {
      lastContentRef.current = now();
      addLog("contentSafeAreaChanged", `top=${webApp.contentSafeAreaInset?.top ?? "?"}`);
      setTimeout(() => refresh(pathname), 35);
    };
    const onViewport = () => {
      lastViewportRef.current = now();
      const wa = webApp as typeof webApp & { viewportHeight?: number; viewportStableHeight?: number };
      addLog("viewportChanged", `h=${wa.viewportHeight ?? "?"} stable=${wa.viewportStableHeight ?? "?"}`);
      setTimeout(() => refresh(pathname), 10);
    };

    webApp.onEvent("safeAreaChanged", onSafe);
    webApp.onEvent("contentSafeAreaChanged", onContent);
    (webApp.onEvent as (e: string, h: () => void) => void)("viewportChanged", onViewport);

    return () => {
      if (typeof webApp.offEvent === "function") {
        webApp.offEvent("safeAreaChanged", onSafe);
        webApp.offEvent("contentSafeAreaChanged", onContent);
        (webApp.offEvent as (e: string, h: () => void) => void)("viewportChanged", onViewport);
      }
    };
  }, [visible, pathname, addLog, refresh]);

  // Poll every 2s to catch CSS var changes not surfaced via events
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => refresh(pathname), 2000);
    return () => clearInterval(id);
  }, [visible, pathname, refresh]);

  const handleCopy = useCallback(() => {
    if (!state) return;
    const text = [
      `=== TG DEBUG SNAPSHOT ${now()} ===`,
      `pathname: ${state.pathname}`,
      `isTgContext: ${state.isTgContext}`,
      `hasTgWebApp: ${state.hasTgWebApp}`,
      `platform: ${state.platform}`,
      `version: ${state.version}`,
      `isExpanded: ${state.isExpanded}`,
      `isFullscreen: ${state.isFullscreen}`,
      `isVerticalSwipesEnabled: ${state.isVerticalSwipesEnabled}`,
      `viewportHeight: ${state.viewportHeight}`,
      `viewportStableHeight: ${state.viewportStableHeight}`,
      `safeAreaInset: top=${state.safeTop} right=${state.safeRight} bottom=${state.safeBottom} left=${state.safeLeft}`,
      `contentSafeAreaInset: top=${state.contentTop} right=${state.contentRight} bottom=${state.contentBottom} left=${state.contentLeft}`,
      `safeTop + contentTop: ${state.safeSum}`,
      `--app-top-offset (style): ${state.cssOffset}`,
      `container paddingTop: ${state.containerPaddingTop}`,
      `last safeAreaChanged: ${state.lastSafe}`,
      `last contentSafeAreaChanged: ${state.lastContent}`,
      `last viewportChanged: ${state.lastViewport}`,
      ``,
      `--- EVENTS (last ${logs.length}) ---`,
      ...logs.map(l => `${l.ts} ${l.event}${l.detail ? ` ${l.detail}` : ""}`),
    ].join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [state, logs]);

  if (!visible || !state) return null;

  const sumNum = state.safeSum !== "–" ? Number(state.safeSum) : null;
  const badSum = sumNum !== null && sumNum < 50;
  const badOffset = state.cssOffset === "0px" || state.cssOffset === "–";
  const badPadding = state.containerPaddingTop === "0px";
  // true (swipes still enabled) is the bad state here — we call
  // disableVerticalSwipes() on init, so this should read "false".
  const badSwipes = state.isVerticalSwipesEnabled === "true";

  const row = (label: string, value: string, bad?: boolean) => (
    <div
      key={label}
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        padding: "1px 0",
        background: bad ? "rgba(255,60,60,0.25)" : "transparent",
      }}
    >
      <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 9, whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ color: "#fff", fontSize: 9, fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );

  const divider = () => (
    <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "4px 0" }} />
  );

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        right: 0,
        zIndex: 99999,
        width: 215,
        maxHeight: "65vh",
        overflowY: "auto",
        background: "rgba(0,0,0,0.9)",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: "8px 0 0 0",
        padding: "6px 8px 8px",
        fontFamily: "monospace",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ color: "#f5c451", fontSize: 10, fontWeight: 700 }}>TG DEBUG</span>
        <button
          onClick={() => refresh(pathname)}
          style={{ color: "#aaa", fontSize: 9, background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          ↺
        </button>
      </div>

      {row("pathname", state.pathname)}
      {row("isTgContext", String(state.isTgContext))}
      {row("hasTgWebApp", String(state.hasTgWebApp))}
      {row("platform", state.platform)}
      {row("version", state.version)}
      {row("isExpanded", state.isExpanded)}
      {row("isFullscreen", state.isFullscreen)}
      {row("isVerticalSwipesEnabled", state.isVerticalSwipesEnabled, badSwipes)}
      {row("viewportHeight", state.viewportHeight)}
      {row("viewportStableHeight", state.viewportStableHeight)}

      {divider()}
      {row("safe.top", state.safeTop)}
      {row("safe.right", state.safeRight)}
      {row("safe.bottom", state.safeBottom)}
      {row("safe.left", state.safeLeft)}

      {divider()}
      {row("content.top", state.contentTop)}
      {row("content.right", state.contentRight)}
      {row("content.bottom", state.contentBottom)}
      {row("content.left", state.contentLeft)}

      {divider()}
      {row("safeTop + contentTop", state.safeSum, badSum)}
      {row("--app-top-offset", state.cssOffset, badOffset)}
      {row("container paddingTop", state.containerPaddingTop, badPadding)}

      {divider()}
      {row("last safeAreaChanged", state.lastSafe)}
      {row("last contentSafeChanged", state.lastContent)}
      {row("last viewportChanged", state.lastViewport)}

      {divider()}

      {/* Copy button */}
      <button
        onClick={handleCopy}
        style={{
          width: "100%",
          padding: "4px 0",
          background: copied ? "rgba(80,200,80,0.2)" : "rgba(245,196,81,0.15)",
          border: `1px solid ${copied ? "rgba(80,200,80,0.4)" : "rgba(245,196,81,0.3)"}`,
          borderRadius: 4,
          color: copied ? "#80e080" : "#f5c451",
          fontSize: 9,
          fontWeight: 700,
          cursor: "pointer",
          marginBottom: 6,
          fontFamily: "monospace",
        }}
      >
        {copied ? "✓ Скопировано" : "Copy debug info"}
      </button>

      {/* Event log */}
      <div style={{ color: "#f5c451", fontSize: 9, fontWeight: 700, marginBottom: 2 }}>EVENTS</div>
      {logs.map((l, i) => (
        <div key={i} style={{ fontSize: 8, color: "rgba(255,255,255,0.7)", lineHeight: 1.4 }}>
          <span style={{ color: "rgba(255,255,255,0.35)" }}>{l.ts}</span>{" "}
          <span style={{ color: "#7dd4fc" }}>{l.event}</span>
          {l.detail ? <span style={{ color: "rgba(255,255,255,0.5)" }}> {l.detail}</span> : null}
        </div>
      ))}
    </div>
  );
}
