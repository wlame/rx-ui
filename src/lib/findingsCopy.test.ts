// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { COPY_BUDGET_BYTES } from './selectionCopy';
import { FINDINGS_COPY_PAGE_SIZE, copyFindings, type FindingsCopyTarget } from './findingsCopy';
import { health, settings } from './stores';
import { commandLog } from './stores/commands';
import { copyLinesBefore, findingsFilter } from './stores/findings';
import { notifications } from './stores/notifications';
import { loadSignatures } from './stores/signatures';
import {
  FINDINGS_DIR,
  FindingsBackend,
  TEST_DEFAULT_IDS,
  finding,
  serveFindings,
} from './testing/fakeFindings';
import { copyText } from './utils/clipboard';
import { formatSize } from './utils/format';

// The clipboard is the browser's: the test reads what would go on it.
vi.mock('./utils/clipboard', () => ({ copyText: vi.fn(async () => true) }));

const APP_LOG = `${FINDINGS_DIR}/app.log`;

const GROUP: FindingsCopyTarget = { kind: 'group', group: 'traceback' };
const SIGNATURE: FindingsCopyTarget = { kind: 'signature', id: 'python-traceback' };
const ALL: FindingsCopyTarget = { kind: 'all' };

/** Two tracebacks and an SQL statement in app.log, every default signature scanned. */
function backendWithFindings(
  found = [
    finding('python-traceback', 120, 121),
    finding('sql-statement', 200),
    finding('python-traceback', 402, 403),
  ],
): FindingsBackend {
  const backend = new FindingsBackend();
  backend.addFile(APP_LOG, found, TEST_DEFAULT_IDS);
  return backend;
}

async function serve(backend: FindingsBackend): Promise<void> {
  serveFindings(backend);
  await health.check();
  await loadSignatures();
}

function findingsRequests(backend: FindingsBackend): URLSearchParams[] {
  return backend.requestsTo('GET', '/v1/findings').map((request) => request.query);
}

function copied(): string {
  const calls = vi.mocked(copyText).mock.calls;
  return calls[calls.length - 1]?.[0] ?? '';
}

function messages() {
  return get(notifications).map((n) => ({ type: n.type, message: n.message }));
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** `count` one-line findings of python-traceback, each line `width` bytes of `x`. */
function wideFindings(count: number, width: number) {
  return Array.from({ length: count }, (_, i) =>
    finding('python-traceback', i + 1, i + 1, { lines: ['x'.repeat(width)] }),
  );
}

beforeEach(() => {
  vi.mocked(copyText).mockClear();
  vi.mocked(copyText).mockResolvedValue(true);
  commandLog.clear();
  copyLinesBefore.set(1);
});

afterEach(() => {
  for (const shown of get(notifications)) notifications.dismiss(shown.id);
  findingsFilter.set('');
  settings.update((s) => ({ ...s, findingsPicker: null }));
  vi.unstubAllGlobals();
});

describe('copyFindings requests', () => {
  it("asks for a group header's findings with their text, one line before, within 8 MiB", async () => {
    const backend = backendWithFindings();
    await serve(backend);

    await copyFindings(APP_LOG, GROUP);

    const requests = findingsRequests(backend);
    expect(requests).toHaveLength(1);
    const [query] = requests;
    expect(query.get('path')).toBe(APP_LOG);
    expect(query.getAll('group')).toEqual(['traceback']);
    expect(query.getAll('signature')).toEqual([]);
    expect(query.get('text')).toBe('true');
    expect(query.get('before')).toBe('1');
    expect(query.get('max_bytes')).toBe(String(COPY_BUDGET_BYTES));
    expect(query.get('limit')).toBe(String(FINDINGS_COPY_PAGE_SIZE));
    expect(query.get('offset')).toBe('0');
  });

  it("asks for one signature's findings from a signature header", async () => {
    const backend = backendWithFindings();
    await serve(backend);

    await copyFindings(APP_LOG, SIGNATURE);

    const [query] = findingsRequests(backend);
    expect(query.getAll('signature')).toEqual(['python-traceback']);
    expect(query.getAll('group')).toEqual([]);
  });

  it('asks Copy all with neither a group nor a signature, and with the panel filters', async () => {
    const backend = backendWithFindings();
    await serve(backend);
    settings.update((s) => ({ ...s, findingsPicker: ['python-traceback', 'sql-statement'] }));
    findingsFilter.set('line 4');

    await copyFindings(APP_LOG, ALL);

    const [query] = findingsRequests(backend);
    expect(query.getAll('group')).toEqual([]);
    expect(query.getAll('signature')).toEqual([]);
    expect(query.get('signatures')).toBe('python-traceback,sql-statement');
    expect(query.get('q')).toBe('line 4');
    expect(copied()).toBe(
      '==> app.log:402-403  python-traceback  (1 line before) <==\nLINE 401\nLINE 402\nLINE 403\n',
    );
  });

  it('asks the lines before chosen in the menu', async () => {
    const backend = backendWithFindings();
    await serve(backend);
    copyLinesBefore.set(3);

    await copyFindings(APP_LOG, GROUP);

    expect(findingsRequests(backend)[0].get('before')).toBe('3');
  });

  it('pages with an offset until the total, giving each page what is left of the budget', async () => {
    const backend = backendWithFindings(wideFindings(FINDINGS_COPY_PAGE_SIZE + 3, 10));
    await serve(backend);

    await copyFindings(APP_LOG, SIGNATURE);

    const requests = findingsRequests(backend);
    expect(requests.map((q) => q.get('offset'))).toEqual(['0', String(FINDINGS_COPY_PAGE_SIZE)]);
    expect(Number(requests[1].get('max_bytes'))).toBeLessThan(COPY_BUDGET_BYTES);
    expect(Number(requests[1].get('max_bytes'))).toBeGreaterThan(0);
    expect(messages()).toContainEqual({
      type: 'success',
      message: `Copied 10,003 findings (${formatSize(bytes(copied()))})`,
    });
  });

  it('asks no further page once the budget is spent', async () => {
    // The lines of 10,000 findings (about 811 bytes each with the line
    // before) fit the backend's 8 MiB, so it cuts nothing on the first
    // page; with their headers they take more than 8 MiB in the copy.
    const backend = backendWithFindings(wideFindings(FINDINGS_COPY_PAGE_SIZE + 1, 800));
    await serve(backend);

    await copyFindings(APP_LOG, SIGNATURE);

    expect(findingsRequests(backend)).toHaveLength(1);
    const text = copied();
    expect(bytes(text)).toBeLessThanOrEqual(COPY_BUDGET_BYTES);
    const last = text.trimEnd().split('\n').at(-1) ?? '';
    const match = /^\[([\d,]+) of 10,001 findings copied: the copy stops at 8\.0 MB\]$/.exec(last);
    expect(match).not.toBeNull();
    expect(messages()).toContainEqual({
      type: 'warning',
      message: `Copied ${match?.[1]} of 10,001 findings: the copy stops at 8.0 MB`,
    });
  });

  it('asks no further page after the backend cut the text, though the list goes on', async () => {
    // Finding 5,000 alone is over the budget: the backend gives it and
    // every later finding of the page no text.
    const found = wideFindings(FINDINGS_COPY_PAGE_SIZE + 1, 10);
    found[4999] = { ...found[4999], lines: ['x'.repeat(9 << 20)] };
    const backend = backendWithFindings(found);
    await serve(backend);

    await copyFindings(APP_LOG, SIGNATURE);

    expect(findingsRequests(backend)).toHaveLength(1);
    expect(copied().trimEnd().split('\n').at(-1)).toBe(
      '[4,999 of 10,001 findings copied: the copy stops at 8.0 MB]',
    );
  });

  it('stops where the backend ran out of the budget, and says how many it copied', async () => {
    const backend = backendWithFindings(wideFindings(12, 1 << 20));
    await serve(backend);

    await copyFindings(APP_LOG, SIGNATURE);

    expect(findingsRequests(backend)).toHaveLength(1);
    expect(copied().trimEnd().split('\n').at(-1)).toMatch(
      /^\[[78] of 12 findings copied: the copy stops at 8\.0 MB\]$/,
    );
  });
});

describe('copyFindings text', () => {
  it('copies each finding under a header naming its signature and the line before', async () => {
    const backend = backendWithFindings();
    await serve(backend);

    await copyFindings(APP_LOG, GROUP);

    const text = copied();
    expect(text).toBe(
      [
        '==> app.log:120-121  python-traceback  (1 line before) <==',
        'LINE 119',
        'LINE 120',
        'LINE 121',
        '',
        '==> app.log:402-403  python-traceback  (1 line before) <==',
        'LINE 401',
        'LINE 402',
        'LINE 403',
        '',
      ].join('\n'),
    );
    expect(messages()).toContainEqual({
      type: 'success',
      message: `Copied 2 findings (${formatSize(bytes(text))})`,
    });
  });

  it('copies no line before when none is chosen', async () => {
    const backend = backendWithFindings();
    await serve(backend);
    copyLinesBefore.set(0);

    await copyFindings(APP_LOG, SIGNATURE);

    expect(findingsRequests(backend)[0].get('before')).toBe('0');
    expect(copied().split('\n')[0]).toBe('==> app.log:120-121  python-traceback <==');
  });

  it('copies a masked line as the backend sent it', async () => {
    const key = finding('aws-access-key', 7, 9, {
      lines: ['-----BEGIN KEY-----', '[masked, 1620 bytes]', '-----END KEY-----'],
      masked: true,
    });
    const backend = backendWithFindings([key]);
    await serve(backend);

    await copyFindings(APP_LOG, { kind: 'signature', id: 'aws-access-key' });

    expect(copied()).toContain('\n[masked, 1620 bytes]\n');
  });

  it('says what a capped signature found and stored', async () => {
    const backend = backendWithFindings();
    backend.setCount(APP_LOG, 'python-traceback', 48210);
    await serve(backend);

    await copyFindings(APP_LOG, SIGNATURE);

    const text = copied();
    expect(text.trimEnd().split('\n').at(-1)).toBe(
      '[2 findings copied (of 48,210 found, 2 stored)]',
    );
    expect(messages()).toContainEqual({
      type: 'success',
      message: `Copied 2 findings (${formatSize(bytes(text))}) of 48,210 found, 2 stored`,
    });
  });

  it('says why when the backend refuses, and copies nothing', async () => {
    const backend = new FindingsBackend();
    backend.addFile(APP_LOG, [], [], true);
    await serve(backend);

    await copyFindings(APP_LOG, ALL);

    expect(copyText).not.toHaveBeenCalled();
    expect(messages()).toContainEqual({
      type: 'error',
      message: `Could not copy the findings: binary file: ${APP_LOG}`,
    });
  });

  it('copies nothing when no finding is listed', async () => {
    const backend = backendWithFindings([]);
    await serve(backend);

    await copyFindings(APP_LOG, ALL);

    expect(copyText).not.toHaveBeenCalled();
    expect(messages()).toContainEqual({ type: 'info', message: 'No findings to copy' });
  });
});

describe('the command log of a copy of findings', () => {
  // The command is the backend's: rx-go names the signatures a header
  // narrows the picker's selection to, in catalogue order, so a group
  // header's command lists the group's signatures and no others.
  it("records the backend's command for a group header", async () => {
    const backend = backendWithFindings();
    await serve(backend);

    await copyFindings(APP_LOG, GROUP);

    expect(get(commandLog)[0]).toMatchObject({
      command: 'rx trace /logs/app.log --before=1 --signatures=python-traceback,java-exception',
      action: 'findings',
    });
    expect(get(commandLog)[0]).not.toHaveProperty('note');
  });

  it("records a signature header's id and Copy all's selection as the backend gives them", async () => {
    const backend = backendWithFindings();
    await serve(backend);
    copyLinesBefore.set(2);

    await copyFindings(APP_LOG, SIGNATURE);
    expect(get(commandLog)[0].command).toBe(
      'rx trace /logs/app.log --before=2 --signatures=python-traceback',
    );

    await copyFindings(APP_LOG, ALL);
    expect(get(commandLog)[0].command).toBe(
      'rx trace /logs/app.log --before=2 --signatures=default',
    );
  });

  it('leaves --before out when no line before each finding is copied', async () => {
    const backend = backendWithFindings();
    await serve(backend);
    copyLinesBefore.set(0);

    await copyFindings(APP_LOG, ALL);

    expect(get(commandLog)[0].command).toBe('rx trace /logs/app.log --signatures=default');
  });

  // The filter text has no command-line flag: the backend says so in
  // cli_command_note, and the log keeps the note with the command.
  it("keeps the backend's note with the command when the filter text narrows the copy", async () => {
    const backend = backendWithFindings();
    await serve(backend);
    findingsFilter.set('sql');

    await copyFindings(APP_LOG, ALL);

    expect(get(commandLog)[0]).toMatchObject({
      command: 'rx trace /logs/app.log --before=1 --signatures=default',
      note: 'q has no command-line flag: the command lists more findings than this answer',
    });
  });

  // Nothing is built in the viewer: an answer without a command records none.
  it('records nothing when the backend gives no command, and still copies', async () => {
    const backend = backendWithFindings();
    backend.omitsCommand = true;
    await serve(backend);

    await copyFindings(APP_LOG, GROUP);

    expect(get(commandLog)).toEqual([]);
    expect(copyText).toHaveBeenCalledTimes(1);
  });
});
