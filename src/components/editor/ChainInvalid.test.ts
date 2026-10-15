// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { ChainReason } from '$lib/types';
import ChainInvalid from './ChainInvalid.svelte';

let body: ChainInvalid | null = null;

function mount(reasons: ChainReason[], detail: string | null = null): string {
  const target = document.createElement('div');
  document.body.appendChild(target);
  body = new ChainInvalid({ target, props: { reasons, detail } });
  return target.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

afterEach(() => {
  body?.$destroy();
  body = null;
  document.body.replaceChildren();
});

describe('ChainInvalid', () => {
  it('lists each reason with its code and the words of the backend', () => {
    const text = mount([
      {
        code: 'unreadable',
        parts: ['a.log.1'],
        message: 'a.log.1 cannot be read',
        overlap_ms: null,
      },
      {
        code: 'too_many_parts',
        parts: [],
        message: 'the chain has 10,001 parts',
        overlap_ms: null,
      },
    ]);

    expect(text).toContain('unreadable: a.log.1 cannot be read');
    expect(text).toContain('too_many_parts: the chain has 10,001 parts');
  });

  it('gives the message of an entries_overlap reason like the other reasons', () => {
    const message =
      'system@a.journal and system@b.journal hold entries in common: the first ends at sequence number 90, the second starts at 80';

    const text = mount([
      {
        code: 'entries_overlap',
        parts: ['system@a.journal', 'system@b.journal'],
        message,
        overlap_ms: null,
      },
    ]);

    expect(text).toContain(`entries_overlap: ${message}`);
  });
});
