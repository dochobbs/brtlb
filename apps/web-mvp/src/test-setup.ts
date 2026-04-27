import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom in our vitest environment ships with a stub `localStorage` that lacks
// the standard methods. Replace it with a complete in-memory polyfill so
// store.ts and any other code that calls Storage methods actually works.
function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
  };
}

const memoryLocal = makeMemoryStorage();
const memorySession = makeMemoryStorage();

Object.defineProperty(globalThis, 'localStorage', {
  value: memoryLocal,
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
  value: memorySession,
  writable: true,
  configurable: true,
});

afterEach(() => {
  cleanup();
});
