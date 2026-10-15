import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { commandLog } from './stores/commands';
import { notifications } from './stores/notifications';
import {
  COPY_BUDGET_BYTES,
  canCopySelection,
  copySelection,
  startSelectionCopy,
} from './selectionCopy';
import { CHAIN_T0, chainDescription, chainPart, chainTabOf } from './testing/chainDescription';
import type { OpenFile } from './types';
import { copyText } from './utils/clipboard';

// The clipboard is the browser's: the test reads what would go on it.
vi.mock('./utils/clipboard', () => ({ copyText: vi.fn(async () => true) }));

function fileTab(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    path: '/logs/app.log',
    name: 'app.log',
    lines: [],
    totalLines: null,
    startLine: 1,
    endLine: 0,
    loading: false,
    error: null,
    isCompressed: false,
    compressionFormat: null,
    reachedStart: true,
    reachedEnd: false,
    syntaxHighlighting: false,
    fileSize: 1000,
    regexFilter: null,
    showInvisibleChars: false,
    wordWrap: false,
    isIndexed: false,
    selectedLines: [],
    anchorLine: 1,
    indexBuild: null,
    fileType: null,
    journal: null,
    pendingIndex: null,
    backgroundIndexBuild: null,
    timeRange: null,
    isReadingTimeRange: false,
    timeJump: null,
    ...overrides,
  };
}

function answer(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    statusText: String(status),
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
  };
}

/** The lines `rx samples` gives for one `lines` key: each `LINE <n>`, or `width` bytes of `x`. */
function linesOf(key: string, width = 0): string[] {
  const [start, end = start] = key.split('-').map(Number);
  return Array.from({ length: end - start + 1 }, (_, i) =>
    width > 0 ? 'x'.repeat(width) : `LINE ${start + i}`,
  );
}

/** Answer `/v1/samples` with the lines of each key asked, and record each request. */
function serveSamples(width = 0) {
  const requests: URLSearchParams[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const params = new URL(url, 'http://localhost').searchParams;
      requests.push(params);
      const keys = (params.get('lines') ?? '').split(',');
      return answer(200, {
        path: params.get('path'),
        samples: Object.fromEntries(keys.map((key) => [key, linesOf(key, width)])),
        before_context: 0,
        after_context: 0,
        lines: {},
        offsets: {},
        is_compressed: false,
        compression_format: null,
        cli_command: `rx samples ${params.get('path')} --lines=${params.get('lines')} --context=0`,
      });
    }),
  );
  return requests;
}

function messages() {
  return get(notifications).map((n) => ({ type: n.type, message: n.message }));
}

beforeEach(() => {
  vi.mocked(copyText).mockClear();
  vi.mocked(copyText).mockResolvedValue(true);
  commandLog.clear();
});

afterEach(() => {
  for (const shown of get(notifications)) notifications.dismiss(shown.id);
  vi.unstubAllGlobals();
});

describe('copySelection of a file tab', () => {
  const selected = fileTab({
    selectedLines: [
      { start: 120, end: 122 },
      { start: 200, end: 200 },
    ],
  });

  it('asks one samples request for every range, without context lines', async () => {
    const requests = serveSamples();

    await copySelection(selected);

    expect(requests).toHaveLength(1);
    expect(requests[0].get('path')).toBe('/logs/app.log');
    expect(requests[0].get('lines')).toBe('120-122,200');
    expect(requests[0].get('context')).toBe('0');
  });

  it('copies each range under a header that names the file and the lines', async () => {
    serveSamples();

    await copySelection(selected);

    expect(copyText).toHaveBeenCalledWith(
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
    expect(messages()).toContainEqual({ type: 'success', message: 'Copied 2 ranges' });
  });

  it("records the answer's command in the command log", async () => {
    serveSamples();

    await copySelection(selected);

    expect(get(commandLog)[0]).toMatchObject({
      command: 'rx samples /logs/app.log --lines=120-122,200 --context=0',
      action: 'file',
    });
  });

  it('copies the whole ranges that fit in 8 MiB, and says how many', async () => {
    // Each line is 1 MiB: the first range's five lines fit, the second's four more do not.
    serveSamples(1 << 20);
    const big = fileTab({
      selectedLines: [
        { start: 1, end: 5 },
        { start: 10, end: 13 },
      ],
    });

    await copySelection(big);

    const text = vi.mocked(copyText).mock.calls[0][0];
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(COPY_BUDGET_BYTES);
    expect(text).toContain('==> app.log:1-5 <==');
    expect(text).not.toContain('==> app.log:10-13 <==');
    expect(text.trimEnd().split('\n').at(-1)).toBe(
      '[1 of 2 ranges copied: the copy stops at 8.0 MB]',
    );
    expect(messages()).toContainEqual({
      type: 'warning',
      message: 'Copied 1 of 2 ranges: the copy stops at 8.0 MB',
    });
  });

  it('says why when the backend refuses the request, and copies nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answer(400, { detail: 'the answer would hold too many lines' })),
    );

    await copySelection(selected);

    expect(copyText).not.toHaveBeenCalled();
    expect(messages()).toContainEqual({
      type: 'error',
      message: 'Could not copy the selected lines: the answer would hold too many lines',
    });
  });

  it('says so when the clipboard takes nothing', async () => {
    serveSamples();
    vi.mocked(copyText).mockResolvedValue(false);

    await copySelection(selected);

    expect(messages()).toContainEqual({
      type: 'error',
      message: 'Could not copy the selected lines: the browser refused the clipboard',
    });
  });

  it('starts the same copy for Cmd+C in the editor, and says whether it started one', async () => {
    const requests = serveSamples();

    expect(startSelectionCopy(fileTab())).toBe(false);
    expect(startSelectionCopy(selected)).toBe(true);
    await vi.waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));

    expect(requests).toHaveLength(1);
    expect(requests[0].get('lines')).toBe('120-122,200');
  });

  it('asks nothing when nothing is selected', async () => {
    const requests = serveSamples();
    await copySelection(fileTab());
    expect(requests).toEqual([]);
  });
});

describe('copySelection of a log chain tab', () => {
  function readyChainTab(): OpenFile {
    const description = chainDescription({
      path: '/l/app.log',
      name: 'app.log',
      state: 'ready',
      parts: [
        chainPart('app.log.1', { key: '1', first_ms: CHAIN_T0, line_count: 100, global_start: 1 }),
        chainPart('app.log', { is_active: true, line_count: 50, global_start: 101 }),
      ],
    });
    return fileTab({
      path: 'chain:/l/app.log',
      chain: chainTabOf(description),
      selectedLines: [{ start: 99, end: 102 }],
    });
  }

  it('asks the chain for the global lines and copies each part under its own header', async () => {
    const requests: URLSearchParams[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requests.push(new URL(url, 'http://localhost').searchParams);
        return answer(200, {
          path: '/l/app.log',
          name: 'app.log',
          state: 'ready',
          fingerprint: 'abcdefabcdef0123',
          parts: [],
          lines: { '99-102': 99 },
          timestamps: {},
          before_context: 0,
          after_context: 0,
          index_build: null,
          index_build_refused: null,
          cli_command: 'rx logs samples /l/app.log --lines=99-102 --context=0',
          samples: {
            '99-102': [
              piece('app.log.1', 99, ['A 99', 'A 100']),
              piece('app.log', 1, ['B 1', 'B 2']),
            ],
          },
        });
      }),
    );

    await copySelection(readyChainTab());

    expect(requests[0].get('path')).toBe('/l/app.log');
    expect(requests[0].get('lines')).toBe('99-102');
    expect(requests[0].get('context')).toBe('0');
    expect(copyText).toHaveBeenCalledWith(
      '==> app.log.1:99-100 <==\nA 99\nA 100\n\n==> app.log:1-2 <==\nB 1\nB 2\n',
    );
    expect(get(commandLog)[0]).toMatchObject({
      command: 'rx logs samples /l/app.log --lines=99-102 --context=0',
      details: ['rx samples app.log.1 --lines=99-100', 'rx samples app.log --lines=1-2'],
    });
  });

  it('cannot copy from a chain that is not ready, whose lines have no global numbers yet', () => {
    const pending = readyChainTab();
    const chain = pending.chain;
    if (!chain) throw new Error('no chain');
    expect(canCopySelection(pending)).toBe(true);
    expect(canCopySelection({ ...pending, chain: { ...chain, numbering: 'local' } })).toBe(false);
    expect(startSelectionCopy({ ...pending, chain: { ...chain, numbering: 'local' } })).toBe(false);
  });
});

function piece(part: string, firstLocal: number, lines: string[]) {
  return {
    part,
    first_local_line: firstLocal,
    first_global_line: -1,
    lines,
    line_timestamps: null,
    part_start: false,
    part_end: false,
    cli_command: `rx samples ${part} --lines=${firstLocal}-${firstLocal + lines.length - 1}`,
  };
}
