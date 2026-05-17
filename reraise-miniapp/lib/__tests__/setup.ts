import { vi } from 'vitest';

// Mock Telegram WebApp API
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

// Ensure sessionStorage works (jsdom supports it, but mock for robustness)
const sessionStorageMap = new Map<string, string>();
Object.defineProperty(window, 'sessionStorage', {
  value: {
    getItem: (key: string) => sessionStorageMap.get(key) ?? null,
    setItem: (key: string, value: string) => sessionStorageMap.set(key, value),
    removeItem: (key: string) => sessionStorageMap.delete(key),
    clear: () => sessionStorageMap.clear(),
    get length() {
      return sessionStorageMap.size;
    },
  },
  writable: true,
});
