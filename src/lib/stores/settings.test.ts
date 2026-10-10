import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { DEFAULT_SETTINGS } from '../utils/appSettings';

/** Makes every use of `localStorage` throw, as a browser that blocks site data does. */
function blockStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
}

describe('settings', () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    vi.resetModules();
  });

  // The store loads with the app's first modules; a throw there leaves a
  // blank page.
  it('loads with the defaults when storage is refused', async () => {
    blockStorage();

    const { settings } = await import('./settings');

    expect(get(settings)).toEqual(DEFAULT_SETTINGS);
  });

  it('loads the defaults over the chain mode an older viewer stored', async () => {
    const stored = JSON.stringify({ ...DEFAULT_SETTINGS, chainMode: true });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => stored, setItem: () => {} },
    });

    const { settings } = await import('./settings');

    expect(get(settings)).toEqual(DEFAULT_SETTINGS);
    expect(get(settings)).not.toHaveProperty('chainMode');
  });

  // The findings picker's choice is a viewer's own: kept in the browser,
  // under the settings key, never in the link.
  it("keeps the findings picker's choice across a reload", async () => {
    const saved = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => saved.get(key) ?? null,
        setItem: (key: string, value: string) => saved.set(key, value),
      },
    });
    const before = await import('./settings');
    before.settings.update((s) => ({ ...s, findingsPicker: ['sql-statement', 'email-address'] }));

    vi.resetModules();
    const after = await import('./settings');

    expect([...saved.keys()]).toEqual(['rx-settings']);
    expect(get(after.settings).findingsPicker).toEqual(['sql-statement', 'email-address']);
  });

  it("keeps the findings picker's choice for the page when storage is refused", async () => {
    blockStorage();
    const { settings } = await import('./settings');

    settings.update((s) => ({ ...s, findingsPicker: ['sql-statement'] }));

    expect(get(settings).findingsPicker).toEqual(['sql-statement']);
  });

  it('keeps a change for the page when storage refuses to save it', async () => {
    blockStorage();
    const { settings } = await import('./settings');

    settings.update((s) => ({ ...s, theme: 'dark' }));

    expect(get(settings).theme).toBe('dark');
  });
});
