import { describe, expect, it } from 'vitest';
import { copyBlockBytes, formatCopyBlocks, type CopyBlock } from './copyFormat';

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

/** A finding's block: `lines` from `start`, with `before` lines above it. */
function findingBlock(start: number, end: number, signature: string, before = 0): CopyBlock {
  return {
    ...block(start, end),
    signature,
    before: Array.from({ length: before }, (_, i) => `LINE ${start - before + i}`),
  };
}

describe('formatCopyBlocks of findings', () => {
  it('names the signature after the lines, and the lines before when there are some', () => {
    const { text } = formatCopyBlocks([findingBlock(120, 121, 'python-traceback', 1)], 1 << 20, {
      unit: 'finding',
    });

    expect(text).toBe(
      [
        '==> app.log:120-121  python-traceback  (1 line before) <==',
        'LINE 119',
        'LINE 120',
        'LINE 121',
        '',
      ].join('\n'),
    );
  });

  it('leaves the lines before out of the header with none, and counts three', () => {
    const { text } = formatCopyBlocks(
      [findingBlock(200, 200, 'error-line'), findingBlock(402, 403, 'python-traceback', 3)],
      1 << 20,
      { unit: 'finding' },
    );

    expect(text).toBe(
      [
        '==> app.log:200  error-line <==',
        'LINE 200',
        '',
        '==> app.log:402-403  python-traceback  (3 lines before) <==',
        'LINE 399',
        'LINE 400',
        'LINE 401',
        'LINE 402',
        'LINE 403',
        '',
      ].join('\n'),
    );
  });

  it('says in a last line how many of all the findings it copied when the budget cuts', () => {
    const blocks = [findingBlock(1, 10, 'a'), findingBlock(20, 29, 'a'), findingBlock(40, 49, 'a')];
    const budget = bytes(formatCopyBlocks(blocks.slice(0, 2), 1 << 20).text) + 60;

    const { text, copied, total } = formatCopyBlocks(blocks, budget, {
      unit: 'finding',
      total: 120,
    });

    expect(copied).toBe(2);
    expect(total).toBe(120);
    expect(text.trimEnd().split('\n').at(-1)).toBe(
      `[2 of 120 findings copied: the copy stops at ${budget} B]`,
    );
    expect(bytes(text)).toBeLessThanOrEqual(budget);
  });

  it('says how many of the total it copied when fewer blocks came than the total', () => {
    const { text, copied, total } = formatCopyBlocks([findingBlock(5, 5, 'a')], 8 << 20, {
      unit: 'finding',
      total: 37,
    });

    expect([copied, total]).toEqual([1, 37]);
    expect(text).toBe(
      '==> app.log:5  a <==\nLINE 5\n\n[1 of 37 findings copied: the copy stops at 8.0 MB]\n',
    );
  });

  it('says how many a capped signature found and stored', () => {
    const { text } = formatCopyBlocks([findingBlock(5, 5, 'a'), findingBlock(9, 9, 'a')], 1 << 20, {
      unit: 'finding',
      cap: { found: 48210, stored: 2 },
    });

    expect(text.trimEnd().split('\n').at(-1)).toBe(
      '[2 findings copied (of 48,210 found, 2 stored)]',
    );
  });

  it('says both when a capped copy is also cut', () => {
    const { text } = formatCopyBlocks([findingBlock(5, 5, 'a')], 8 << 20, {
      unit: 'finding',
      total: 10000,
      cap: { found: 48210, stored: 10000 },
    });

    expect(text.trimEnd().split('\n').at(-1)).toBe(
      '[1 of 10,000 findings copied (of 48,210 found, 10,000 stored): the copy stops at 8.0 MB]',
    );
  });

  it('copies a masked line as the backend gave it', () => {
    const masked = {
      ...findingBlock(7, 8, 'pem-private-key'),
      lines: ['-----BEGIN KEY-----', '[masked, 1620 bytes]'],
    };
    const { text } = formatCopyBlocks([masked], 1 << 20, { unit: 'finding' });
    expect(text).toContain('\n[masked, 1620 bytes]\n');
  });

  it('writes a block of lines without a signature as the selection copy does', () => {
    const plain = formatCopyBlocks([block(120, 122)], 1 << 20).text;
    expect(formatCopyBlocks([block(120, 122)], 1 << 20, { unit: 'finding' }).text).toBe(plain);
    expect(plain.split('\n')[0]).toBe('==> app.log:120-122 <==');
  });

  it('counts a block with its separator as the formatter writes it', () => {
    const blocks = [findingBlock(1, 2, 'a', 1), findingBlock(5, 5, 'b')];
    const whole = formatCopyBlocks(blocks, 1 << 20, { unit: 'finding' }).text;
    expect(blocks.reduce((sum, b) => sum + copyBlockBytes(b), 0)).toBe(bytes(whole) + 1);
  });
});
