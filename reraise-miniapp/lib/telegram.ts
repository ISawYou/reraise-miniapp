export type TelegramWebAppUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
};

export type TelegramWebApp = {
  initData?: string;
  initDataUnsafe?: {
    user?: TelegramWebAppUser;
  };
  expand?: () => void;
  ready?: () => void;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.Telegram?.WebApp ?? null;
}

export function getTelegramUser(): TelegramWebAppUser | null {
  const webApp = getTelegramWebApp();

  if (!webApp) {
    return null;
  }

  return webApp.initDataUnsafe?.user ?? null;
}

export function getTelegramDebugInfo() {
  const webApp = getTelegramWebApp();

  return {
    hasWindow: typeof window !== "undefined",
    hasTelegramObject: typeof window !== "undefined" && !!window.Telegram,
    hasWebApp: !!webApp,
    hasInitData: !!webApp?.initData,
    hasInitDataUnsafe: !!webApp?.initDataUnsafe,
    hasUser: !!webApp?.initDataUnsafe?.user,
    initDataLength: webApp?.initData?.length ?? 0,
  };
}