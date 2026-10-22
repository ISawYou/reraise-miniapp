import { getTelegramInitData, isTelegramMiniAppContext } from "@/lib/telegram";

// The authenticated-request headers: the Telegram initData proof when there is
// one, nothing otherwise (the browser still sends the session cookie).
//
// Outside a Telegram Mini App (the website, an email/OTP web session) there is
// no initData and never will be, but getTelegramInitData() does not know that:
// it polls for ~1.2s before giving up. Awaiting it there delayed EVERY
// authenticated request by that long for nothing (measured on the profile's
// follow block, /api/dealer/me, teams...). isTelegramMiniAppContext() is the
// project's established signal for "are we in a Mini App" (launch params,
// WebApp initData, or initData cached by an earlier page of this session --
// it is what the home bootstrap and academy auth already branch on), so we
// skip the wait only when it says no. Inside Telegram nothing changes: the
// header is still obtained and sent, and the server still verifies it (HMAC)
// before falling back to the cookie.
export async function getAdminHeaders(): Promise<Record<string, string>> {
  if (!isTelegramMiniAppContext()) {
    return {};
  }

  const initData = await getTelegramInitData();

  return initData ? { "X-Telegram-Init-Data": initData } : {};
}

export type FetchAdminJsonOptions = {
  // Defaults to fetchJsonWithRetry's own default (one retry). Pass 0 for a
  // non-idempotent side-effecting request (e.g. a Telegram broadcast send):
  // a 504 from the proxy does NOT mean the server stopped working on it,
  // and blindly repeating such a POST re-runs the side effect (incident
  // 2026-10-21/22: every broadcast delivered twice).
  retries?: number;
};

export async function fetchAdminJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: FetchAdminJsonOptions
): Promise<T> {
  const adminHeaders = await getAdminHeaders();

  return fetchJsonWithRetry<T>(
    input,
    {
      ...init,
      headers: {
        ...adminHeaders,
        ...(init?.headers as Record<string, string> | undefined),
      },
    },
    options?.retries
  );
}

export async function fetchJsonWithRetry<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  retries = 1
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(input, init);
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message =
          typeof payload?.error === "string"
            ? payload.error
            : "Не удалось выполнить запрос";
        throw new Error(message);
      }

      return payload as T;
    } catch (error) {
      if (error instanceof TypeError) {
        lastError = new Error("Сеть нестабильна. Попробуйте еще раз.");
      } else {
        lastError = error;
      }

      if (attempt === retries) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Не удалось выполнить запрос");
}
