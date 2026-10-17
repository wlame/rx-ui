// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { version } from '$lib/stores/version';
import Header from './Header.svelte';

let header: Header | null = null;

afterEach(() => {
  header?.$destroy();
  header = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('Header version badge', () => {
  it('links to the release of the viewer on the rx-ui repository', async () => {
    // The version store reads /version.json, which a production build
    // writes; serve it from a stub so the badge has a version to show.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: 'v0.9.0', buildDate: '2026-10-17', commit: 'abc1234' }),
      })),
    );
    await version.fetch();

    const target = document.createElement('div');
    document.body.appendChild(target);
    header = new Header({ target });
    await tick();

    const badge = target.querySelector<HTMLAnchorElement>('a[title="View release on GitHub"]');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('href')).toBe('https://github.com/wlame/rx-ui/releases/tag/v0.9.0');
  });
});
