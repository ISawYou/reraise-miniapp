export type TelegramWebAppUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
};

export type TelegramWebApp = {
  initDataUnsafe?: {
    user?: TelegramWebAppUser;
  };
  expand?: () => void;
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