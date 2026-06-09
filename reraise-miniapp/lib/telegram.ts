export type TelegramWebAppUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramWebAppInset = {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
};

const TELEGRAM_USER_CACHE_KEY = "reraise.telegram.user";
const TELEGRAM_INIT_DATA_CACHE_KEY = "reraise.telegram.initData";

export type TelegramWebApp = {
  initData?: string;
  initDataUnsafe?: {
    user?: TelegramWebAppUser;
    [key: string]: unknown;
  };
  safeAreaInset?: TelegramWebAppInset;
  contentSafeAreaInset?: TelegramWebAppInset;
  ready?: () => void;
  expand?: () => void;
  requestFullscreen?: () => void;
  disableVerticalSwipes?: () => void;
  setBackgroundColor?: (color: string) => void;
  setHeaderColor?: (color: string) => void;
  onEvent?: (eventType: string, eventHandler: () => void) => void;
  offEvent?: (eventType: string, eventHandler: () => void) => void;
  openTelegramLink?: (url: string) => void;
};

export type TelegramLoginAuthPayload = Record<string, string | number>;

export type TelegramLogin = {
  auth: (
    options: { bot_id: number; request_access?: "write" | "read" },
    callback: (data: TelegramLoginAuthPayload | false) => void
  ) => void;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
      Login?: TelegramLogin;
    };
  }
}

function parseTelegramUserFromInitDataParam(rawValue: string): TelegramWebAppUser | null {
  try {
    const params = new URLSearchParams(rawValue);
    const userRaw = params.get("user");

    if (!userRaw) {
      return null;
    }

    return JSON.parse(userRaw) as TelegramWebAppUser;
  } catch (error) {
    console.error("Failed to parse tgWebAppData user:", error);
    return null;
  }
}

function getTelegramUserFromLaunchParams(): TelegramWebAppUser | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(
      window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash
    );

    const searchInitData = searchParams.get("tgWebAppData");
    if (searchInitData) {
      const user = parseTelegramUserFromInitDataParam(searchInitData);
      if (user) {
        return user;
      }
    }

    const hashInitData = hashParams.get("tgWebAppData");
    if (hashInitData) {
      const user = parseTelegramUserFromInitDataParam(hashInitData);
      if (user) {
        return user;
      }
    }

    return null;
  } catch (error) {
    console.error("Failed to read Telegram launch params:", error);
    return null;
  }
}

function getTelegramInitDataFromLaunchParams(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(
      window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash
    );

    return (
      searchParams.get("tgWebAppData") ??
      hashParams.get("tgWebAppData") ??
      ""
    );
  } catch (error) {
    console.error("Failed to read Telegram initData from launch params:", error);
    return "";
  }
}

function readCachedTelegramUser(): TelegramWebAppUser | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(TELEGRAM_USER_CACHE_KEY);

    if (!rawValue) {
      return null;
    }

    return JSON.parse(rawValue) as TelegramWebAppUser;
  } catch (error) {
    console.error("Failed to read cached Telegram user:", error);
    return null;
  }
}

function cacheTelegramUser(user: TelegramWebAppUser | null) {
  if (typeof window === "undefined" || !user) {
    return;
  }

  try {
    window.sessionStorage.setItem(TELEGRAM_USER_CACHE_KEY, JSON.stringify(user));
  } catch (error) {
    console.error("Failed to cache Telegram user:", error);
  }
}

function readCachedTelegramInitData(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.sessionStorage.getItem(TELEGRAM_INIT_DATA_CACHE_KEY) ?? "";
  } catch (error) {
    console.error("Failed to read cached Telegram initData:", error);
    return "";
  }
}

function cacheTelegramInitData(initData: string) {
  if (typeof window === "undefined" || !initData) {
    return;
  }

  try {
    window.sessionStorage.setItem(TELEGRAM_INIT_DATA_CACHE_KEY, initData);
  } catch (error) {
    console.error("Failed to cache Telegram initData:", error);
  }
}

function hasTelegramLaunchParams(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(
      window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash
    );

    return Boolean(
      searchParams.get("tgWebAppData") || hashParams.get("tgWebAppData")
    );
  } catch (error) {
    console.error("Failed to detect Telegram launch params:", error);
    return false;
  }
}

// Module-level cache: once a valid WebApp is seen, keep its reference.
// window.Telegram.WebApp can be reset to null by telegram-web-app.js
// re-initialising after SPA navigation (no URL params on /admin), but the
// JS object in memory stays valid — its safeAreaInset and event listeners
// remain functional.
let _cachedWebApp: TelegramWebApp | null = null;

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") {
    return null;
  }

  const webApp = window.Telegram?.WebApp ?? null;

  if (webApp) {
    if (webApp.initData) {
      // Full-featured object — always prefer and cache.
      _cachedWebApp = webApp;
      cacheTelegramInitData(webApp.initData);
    } else if (!_cachedWebApp) {
      // Object exists but no initData yet (natively injected before initData
      // is populated). Cache it so it's available for API calls.
      _cachedWebApp = webApp;
    }
    return webApp;
  }

  // window.Telegram.WebApp disappeared (SDK re-init on navigation) — return
  // the last known-good reference so API calls and event listeners keep working.
  return _cachedWebApp;
}

let telegramWebAppScriptPromise: Promise<TelegramWebApp | null> | null = null;

export async function loadTelegramWebAppScript(
  timeoutMs = 2500
): Promise<TelegramWebApp | null> {
  const existingWebApp = getTelegramWebApp();

  if (existingWebApp) {
    return existingWebApp;
  }

  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  if (!isTelegramMiniAppContext()) {
    return null;
  }

  if (!telegramWebAppScriptPromise) {
    telegramWebAppScriptPromise = new Promise<TelegramWebApp | null>((resolve) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[src="https://telegram.org/js/telegram-web-app.js"]'
      );
      const injectedScript = existingScript ?? document.createElement("script");

      const finish = () => resolve(getTelegramWebApp());

      const timer = window.setTimeout(finish, timeoutMs);

      const cleanup = () => {
        window.clearTimeout(timer);
        existingScript?.removeEventListener("load", handleLoad);
        existingScript?.removeEventListener("error", handleError);
        injectedScript.removeEventListener("load", handleLoad);
        injectedScript.removeEventListener("error", handleError);
      };

      const handleLoad = () => {
        cleanup();
        finish();
      };

      const handleError = () => {
        cleanup();
        resolve(null);
      };

      injectedScript.async = true;
      injectedScript.src = "https://telegram.org/js/telegram-web-app.js";
      injectedScript.addEventListener("load", handleLoad, { once: true });
      injectedScript.addEventListener("error", handleError, { once: true });

      if (!existingScript) {
        document.head.appendChild(injectedScript);
      }
    }).finally(() => {
      telegramWebAppScriptPromise = null;
    });
  }

  return telegramWebAppScriptPromise;
}

export async function getTelegramInitData(): Promise<string> {
  const existingInitData = getTelegramWebApp()?.initData ?? "";

  if (existingInitData) {
    return existingInitData;
  }

  const launchParamsInitData = getTelegramInitDataFromLaunchParams();

  if (launchParamsInitData) {
    cacheTelegramInitData(launchParamsInitData);
    return launchParamsInitData;
  }

  const cachedInitData = readCachedTelegramInitData();

  if (cachedInitData) {
    return cachedInitData;
  }

  const webApp = await loadTelegramWebAppScript(2500);
  const nextInitData = webApp?.initData ?? "";

  if (nextInitData) {
    cacheTelegramInitData(nextInitData);
  }

  return nextInitData;
}

// Once true, stays true for the lifetime of this JS module (i.e. the session).
// isTelegramMiniAppContext() used to re-check the URL on every call, which
// returned false after SPA navigation to pages without tgWebAppData params.
let _isTelegramContext: boolean | null = null;

export function isTelegramMiniAppContext(): boolean {
  if (_isTelegramContext === true) return true;

  const webApp = getTelegramWebApp();

  if (webApp?.initData || webApp?.initDataUnsafe?.user) {
    _isTelegramContext = true;
    return true;
  }

  if (hasTelegramLaunchParams()) {
    _isTelegramContext = true;
    return true;
  }

  // Fallback: initData was cached to sessionStorage on a previous call (e.g.
  // on the landing page before SPA-navigating to /admin).
  if (readCachedTelegramInitData()) {
    _isTelegramContext = true;
    return true;
  }

  return false;
}

export function getTelegramUser(): TelegramWebAppUser | null {
  const webApp = getTelegramWebApp();

  if (webApp?.initDataUnsafe?.user) {
    if (webApp.initData) {
      cacheTelegramInitData(webApp.initData);
    }
    cacheTelegramUser(webApp.initDataUnsafe.user);
    return webApp.initDataUnsafe.user;
  }

  const launchParamsUser = getTelegramUserFromLaunchParams();

  if (launchParamsUser) {
    cacheTelegramUser(launchParamsUser);
    return launchParamsUser;
  }

  return readCachedTelegramUser();
}
