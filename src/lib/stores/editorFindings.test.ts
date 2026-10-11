// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { files, health, settings, tree } from '$lib/stores';
import {
  NO_FINDINGS,
  WINDOW_FINDINGS_LIMIT,
  forgetWindowFindings,
  markInputs,
  requestWindowFindings,
  stepFinding,
  windowFindings,
  windowFindingsOf,
} from '$lib/stores/editorFindings';
import {
  findingsByFile,
  findingsFilter,
  findingsOf,
  forgetFindings,
  refreshFindings,
} from '$lib/stores/findings';
import { notifications } from '$lib/stores/notifications';
import { loadSignatures } from '$lib/stores/signatures';
import {
  FINDINGS_DIR,
  FindingsBackend,
  TEST_DEFAULT_IDS,
  finding,
  serveFindings,
} from '$lib/testing/fakeFindings';
import type { Finding } from '$lib/types';

const APP_LOG = `${FINDINGS_DIR}/app.log`;

/** Findings of the default set on lines 10, 20, … 10 × n. */
function everyTenLines(n: number): Finding[] {
  return Array.from({ length: n }, (_, i) =>
    finding(i % 2 === 0 ? 'python-traceback' : 'sql-statement', 10 * (i + 1)),
  );
}

/** A backend that serves signatures, with the catalogue loaded and the tree listed. */
async function serve(backend = new FindingsBackend()) {
  serveFindings(backend);
  await health.check();
  await loadSignatures();
  return backend;
}

async function listTree() {
  await tree.loadRoots();
  await tree.toggleExpanded(FINDINGS_DIR);
}

/** The window requests sent so far: those with `lines`. */
function windowQueries(backend: FindingsBackend): URLSearchParams[] {
  return backend
    .requestsTo('GET', '/v1/findings')
    .map((r) => r.query)
    .filter((query) => query.has('lines'));
}

/** The step requests sent so far: those with `after_line` or `before_line`. */
function stepQueries(backend: FindingsBackend): URLSearchParams[] {
  return backend
    .requestsTo('GET', '/v1/findings')
    .map((r) => r.query)
    .filter((query) => query.has('after_line') || query.has('before_line'));
}

/** Ask for the marks of lines `first` to `last` of `path`, with the inputs as they are now. */
function ask(path: string, first: number, last: number) {
  requestWindowFindings(path, first, last, get(markInputs));
}

/** Let the stubbed requests answer. */
async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

function marksOf(path: string) {
  return windowFindingsOf(get(windowFindings), path);
}

function messages(): string[] {
  return get(notifications).map((n) => n.message);
}

/** Open `path` with lines 1 to 100 loaded and its anchor on `anchorLine`. */
async function openAt(path: string, anchorLine: number) {
  const opening = files.openFile(path);
  await settle();
  await opening;
  files.setAnchorLine(path, anchorLine);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  forgetWindowFindings([]);
  forgetFindings([]);
  findingsFilter.set('');
  settings.update((s) => ({ ...s, findingsPicker: null }));
  for (const file of get(files).openFiles) files.closeFile(file.path);
  for (const n of get(notifications)) notifications.dismiss(n.id);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('requestWindowFindings', () => {
  it("asks for the findings of the window with the panel's choice and filter, and holds them", async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, everyTenLines(5), ['sql-statement', ...TEST_DEFAULT_IDS]);
    settings.update((s) => ({ ...s, findingsPicker: ['sql-statement'] }));
    findingsFilter.set('line');

    ask(APP_LOG, 15, 45);
    await settle();

    const [query] = windowQueries(backend);
    expect(query.get('lines')).toBe('15-45');
    expect(query.get('signatures')).toBe('sql-statement');
    expect(query.get('q')).toBe('line');
    expect(query.get('limit')).toBe(String(WINDOW_FINDINGS_LIMIT));
    expect(marksOf(APP_LOG)).toEqual([finding('sql-statement', 20), finding('sql-statement', 40)]);
  });

  it('asks once per window, and again when the window pages', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, everyTenLines(5), TEST_DEFAULT_IDS);

    ask(APP_LOG, 1, 30);
    ask(APP_LOG, 1, 30);
    await settle();
    ask(APP_LOG, 1, 30);
    ask(APP_LOG, 21, 50);
    await settle();

    expect(windowQueries(backend).map((q) => q.get('lines'))).toEqual(['1-30', '21-50']);
    expect(marksOf(APP_LOG).map((f) => f.start_line)).toEqual([30, 40, 50]);
  });

  it('keeps the answer of the window shown, not of a window the editor left', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, everyTenLines(5), TEST_DEFAULT_IDS);
    backend.holdFindings();

    ask(APP_LOG, 1, 15);
    ask(APP_LOG, 31, 45);
    backend.release();
    await settle();

    expect(marksOf(APP_LOG).map((f) => f.start_line)).toEqual([40]);
  });

  it('asks again when the picker or the filter changes', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, everyTenLines(5), TEST_DEFAULT_IDS);

    ask(APP_LOG, 1, 50);
    findingsFilter.set('sql');
    ask(APP_LOG, 1, 50);
    settings.update((s) => ({ ...s, findingsPicker: ['python-traceback'] }));
    ask(APP_LOG, 1, 50);
    await settle();

    expect(windowQueries(backend).map((q) => [q.get('q'), q.get('signatures')])).toEqual([
      [null, null],
      ['sql', null],
      ['sql', 'python-traceback'],
    ]);
  });

  // A scan's end reads the file's summary again, which says what it holds now.
  it('asks again when the file holds other findings after a scan', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, everyTenLines(5), ['python-traceback']);
    ask(APP_LOG, 1, 50);
    await settle();
    expect(marksOf(APP_LOG)).toHaveLength(3);

    backend.addFile(APP_LOG, everyTenLines(5), TEST_DEFAULT_IDS);
    await refreshFindings(APP_LOG);
    ask(APP_LOG, 1, 50);
    await settle();

    expect(windowQueries(backend)).toHaveLength(2);
    expect(marksOf(APP_LOG)).toHaveLength(5);
  });

  it('asks nothing for a file the tree lists without findings, and asks once it has some', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, everyTenLines(5), []);
    await listTree();

    ask(APP_LOG, 1, 50);
    await settle();
    expect(windowQueries(backend)).toHaveLength(0);
    expect(marksOf(APP_LOG)).toBe(NO_FINDINGS);

    tree.markFindings(APP_LOG, 'partial', 2);
    backend.addFile(APP_LOG, everyTenLines(5), ['sql-statement']);
    ask(APP_LOG, 1, 50);
    await settle();

    expect(windowQueries(backend)).toHaveLength(1);
    expect(marksOf(APP_LOG)).toHaveLength(2);
  });

  it('asks nothing and marks nothing when no signature is picked', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, everyTenLines(5), TEST_DEFAULT_IDS);
    ask(APP_LOG, 1, 50);
    await settle();

    settings.update((s) => ({ ...s, findingsPicker: [] }));
    ask(APP_LOG, 1, 50);
    await settle();

    expect(windowQueries(backend)).toHaveLength(1);
    expect(marksOf(APP_LOG)).toBe(NO_FINDINGS);
  });

  it("asks nothing for a log chain's tab, nor of a backend without signatures", async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, everyTenLines(5), TEST_DEFAULT_IDS);
    ask(`chain:${APP_LOG}`, 1, 50);
    await settle();
    expect(windowQueries(backend)).toHaveLength(0);

    const without = await serve(new FindingsBackend({ features: [] }));
    without.addFile(APP_LOG, everyTenLines(5), TEST_DEFAULT_IDS);
    ask(APP_LOG, 1, 50);
    await settle();

    expect(windowQueries(without)).toHaveLength(0);
  });
});

describe('stepFinding', () => {
  it('opens the next finding below the anchor line, as a click in the panel does', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, everyTenLines(5), TEST_DEFAULT_IDS);
    await openAt(APP_LOG, 20);

    expect(stepFinding(APP_LOG, 20, 'next')).toBe(true);
    await settle();

    const [query] = stepQueries(backend);
    expect(query.get('after_line')).toBe('20');
    expect(query.get('limit')).toBe('1');
    const tab = get(files).openFiles.find((f) => f.path === APP_LOG);
    expect(tab?.selectedLines).toEqual([{ start: 30, end: 30 }]);
    expect(tab?.anchorLine).toBe(30);
    expect(findingsOf(get(findingsByFile), APP_LOG).currentId).not.toBeNull();
  });

  it('opens the previous finding above the anchor line', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, everyTenLines(5), TEST_DEFAULT_IDS);
    await openAt(APP_LOG, 30);

    stepFinding(APP_LOG, 30, 'previous');
    await settle();

    expect(stepQueries(backend)[0].get('before_line')).toBe('30');
    const tab = get(files).openFiles.find((f) => f.path === APP_LOG);
    expect(tab?.selectedLines).toEqual([{ start: 20, end: 20 }]);
  });

  it.each([
    ['next', 50, 'No more findings below'],
    ['previous', 10, 'No more findings above'],
  ] as const)('says so when no finding is %s', async (direction, anchor, message) => {
    const backend = await serve();
    backend.addFile(APP_LOG, everyTenLines(5), TEST_DEFAULT_IDS);
    await openAt(APP_LOG, anchor);

    stepFinding(APP_LOG, anchor, direction);
    await settle();

    expect(messages()).toContain(message);
    expect(get(files).openFiles[0].selectedLines).toEqual([]);
  });

  it("steps within the panel's choice and filter", async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, everyTenLines(5), TEST_DEFAULT_IDS);
    await openAt(APP_LOG, 10);
    settings.update((s) => ({ ...s, findingsPicker: ['python-traceback'] }));
    findingsFilter.set('line 50');

    stepFinding(APP_LOG, 10, 'next');
    await settle();

    const [query] = stepQueries(backend);
    expect(query.get('signatures')).toBe('python-traceback');
    expect(query.get('q')).toBe('line 50');
    expect(get(files).openFiles[0].selectedLines).toEqual([{ start: 50, end: 50 }]);
  });

  it('says a file the picked signatures have not scanned is not scanned', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, [], []);
    await openAt(APP_LOG, 10);

    stepFinding(APP_LOG, 10, 'next');
    await settle();

    expect(messages().some((m) => m.includes('not scanned'))).toBe(true);
  });

  // A tab that closed while its step was asked for keeps no request.
  it('drops a step of a file whose findings were forgotten', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, everyTenLines(5), TEST_DEFAULT_IDS);
    await openAt(APP_LOG, 20);
    backend.holdFindings();

    stepFinding(APP_LOG, 20, 'next');
    await settle();
    forgetWindowFindings([]);
    backend.release();
    await settle();

    expect(stepQueries(backend)).toHaveLength(1);
    expect(get(files).openFiles[0].selectedLines).toEqual([]);
    expect(messages()).toEqual([]);
  });

  it("does not act in a log chain's tab, nor on a backend without signatures", async () => {
    const backend = await serve();
    expect(stepFinding(`chain:${APP_LOG}`, 10, 'next')).toBe(false);
    await settle();
    expect(stepQueries(backend)).toHaveLength(0);

    const without = await serve(new FindingsBackend({ features: [] }));
    expect(stepFinding(APP_LOG, 10, 'next')).toBe(false);
    await settle();

    expect(stepQueries(without)).toHaveLength(0);
  });
});
