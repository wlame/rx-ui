import { describe, expect, it } from 'vitest';
import { formatCopyBlocks, type CopyBlock } from './copyFormat';

function block(start: number, end: number, file = 'app.log'): CopyBlock {
  const lines = Array.from({ length: end - start + 1 }, (_, i) => `LINE ${start + i}`);
  return { file, start, end, lines };
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

describe('formatCopyBlocks', () => {
  it('writes each block under a header naming the file and its lines, with a blank line between', () => {
    const { text, copied, total } = formatCopyBlocks([block(120, 122), block(200, 200)], 1 << 20);

    expect(text).toBe(
      [
        '==> app.log:120-122 <==',
        'LINE 120',
        'LINE 121',
        'LINE 122',
        '',
        '==> app.log:200 <==',
        'LINE 200',
        '',
      ].join('\n'),
    );
    expect(copied).toBe(2);
    expect(total).toBe(2);
  });

  it('writes a header for a block with no lines', () => {
    const { text } = formatCopyBlocks([{ file: 'a.log', start: 5, end: 5, lines: [] }], 1000);
    expect(text).toBe('==> a.log:5 <==\n');
  });

  it('copies whole blocks while they fit, and says in a last line how many it copied', () => {
    const blocks = [block(1, 10), block(20, 29), block(40, 49)];
    const budget = bytes(formatCopyBlocks(blocks.slice(0, 2), 1 << 20).text) + 60;

    const { text, copied, total } = formatCopyBlocks(blocks, budget);

    expect(copied).toBe(2);
    expect(total).toBe(3);
    expect(text).toContain('==> app.log:20-29 <==');
    expect(text).not.toContain('LINE 40');
    expect(text.trimEnd().split('\n').at(-1)).toBe(
      `[2 of 3 ranges copied: the copy stops at ${budget} B]`,
    );
    expect(bytes(text)).toBeLessThanOrEqual(budget);
  });

  it('names the budget of 8 MiB as the notice shows it', () => {
    const big = { file: 'a.log', start: 1, end: 1, lines: ['x'.repeat(9 << 20)] };
    const { text, copied } = formatCopyBlocks([big], 8 << 20);
    expect(copied).toBe(0);
    expect(text).toBe('[0 of 1 ranges copied: the copy stops at 8.0 MB]\n');
  });

  it('counts the bytes of the text as UTF-8', () => {
    const wide = { file: 'a.log', start: 1, end: 1, lines: ['é'.repeat(100)] };
    const whole = formatCopyBlocks([wide], 1 << 20).text;
    expect(formatCopyBlocks([wide], bytes(whole)).copied).toBe(1);
    expect(formatCopyBlocks([wide], bytes(whole) - 1).copied).toBe(0);
  });

  it('gives no text for no blocks', () => {
    expect(formatCopyBlocks([], 1000)).toEqual({ text: '', copied: 0, total: 0 });
  });
});
