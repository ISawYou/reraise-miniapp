import { describe, it, expect, beforeEach, vi } from 'vitest';

const TELEGRAM_USER_CACHE_KEY = 'reraise.telegram.user';
let getTelegramUser: typeof import('@/lib/telegram').getTelegramUser;
let getTelegramWebApp: typeof import('@/lib/telegram').getTelegramWebApp;

beforeEach(async () => {
  vi.resetModules();
  ({ getTelegramUser, getTelegramWebApp } = await import('@/lib/telegram'));
  window.Telegram = {
    WebApp: {
      initData: 'mock',
      initDataUnsafe: {
        user: { id: 123456, first_name: 'Test', username: 'testuser' },
      },
      ready: vi.fn(),
      expand: vi.fn(),
    },
  };
  window.sessionStorage.clear();
});

describe('getTelegramWebApp', () => {
  it('returns the mock WebApp object', () => {
    const webApp = getTelegramWebApp();
    expect(webApp).not.toBeNull();
    expect(webApp?.initData).toBe('mock');
  });
});

describe('getTelegramUser', () => {
  it('returns the mock user from WebApp', () => {
    const user = getTelegramUser();
    expect(user).not.toBeNull();
    expect(user?.id).toBe(123456);
    expect(user?.username).toBe('testuser');
  });

  it('falls back to sessionStorage cache when WebApp is unavailable', () => {
    const cachedUser = { id: 999, first_name: 'Cached', username: 'cached' };
    window.sessionStorage.setItem(TELEGRAM_USER_CACHE_KEY, JSON.stringify(cachedUser));
    window.Telegram = undefined;

    const user = getTelegramUser();
    expect(user).not.toBeNull();
    expect(user?.id).toBe(999);
  });

  it('returns null when no source available', () => {
    window.Telegram = undefined;
    window.sessionStorage.clear();

    const user = getTelegramUser();
    expect(user).toBeNull();
  });
});
