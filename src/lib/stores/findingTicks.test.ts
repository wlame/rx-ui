// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { files, health, settings, tree } from '$lib/stores';
import { markInputs } from '$lib/stores/editorFindings';
import {
  findingsByFile,
  findingsFilter,
  findingsOf,
  forgetFindings,
  refreshFindings,
} from '$lib/stores/findings';
import { MAX_TICK_COLUMNS, openTickFinding, ticksRequestOf } from '$lib/stores/findingTicks';
import { loadSignatures } from '$lib/stores/signatures';
import {
  FINDINGS_DIR,
  FindingsBackend,
  TEST_DEFAULT_IDS,
  finding,
  serveFindings,
} from '$lib/testing/fakeFindings';

const APP_LOG = `${FINDINGS_DIR}/app.log`;
const AXIS = { startMs: 1_000_000, endMs: 2_000_000 };

async function serve(backend: FindingsBackend) {
  serveFindings(backend);
  await health.check();
  await loadSignatures();
  return backend;
}

/** The ticks request of app.log for a track `width` px wide, with the inputs as they are now. */
function requestOf(width: number, zone?: string, path = APP_LOG) {
  return ticksRequestOf(path, { width, axis: AXIS, zone, marks: get(markInputs) });
}

async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  forgetFindings([]);
  findingsFilter.set('');
  settings.update((s) => ({ ...s, findingsPicker: null }));
  for (const file of get(files).openFiles) files.closeFile(file.path);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ticksRequestOf', () => {
  it("asks one column per pixel with the panel's filters, and no findings but one", async () => {
    const backend = await serve(new FindingsBackend());
    backend.addFile(APP_LOG, [], TEST_DEFAULT_IDS);
    settings.update((s) => ({ ...s, findingsPicker: ['sql-statement'] }));
    findingsFilter.set('error');

    expect(requestOf(640)?.query).toEqual({
      signatures: ['sql-statement'],
      q: 'error',
      ticks: 640,
      limit: 1,
    });
  });

  it('carries the zone the file is read in', async () => {
    await serve(new FindingsBackend());
    expect(requestOf(640, '+02:00')?.query.fileTz).toBe('+02:00');
    expect(requestOf(640)?.query).not.toHaveProperty('fileTz');
  });

  it('asks at most the columns the backend draws, and nothing for a track not laid out', async () => {
    await serve(new FindingsBackend());
    expect(requestOf(9000)?.query.ticks).toBe(MAX_TICK_COLUMNS);
    expect(requestOf(0)).toBeNull();
  });

  it('asks again for another width, zone, time range or a scan that changed the file', async () => {
    const backend = await serve(new FindingsBackend());
    backend.addFile(APP_LOG, [finding('sql-statement', 4)], ['sql-statement']);
    const key = requestOf(640)?.key;

    expect(requestOf(640)?.key).toBe(key);
    expect(requestOf(641)?.key).not.toBe(key);
    expect(requestOf(640, '+02:00')?.key).not.toBe(key);
    const wider = ticksRequestOf(APP_LOG, {
      width: 640,
      axis: { ...AXIS, endMs: AXIS.endMs + 1 },
      zone: undefined,
      marks: get(markInputs),
    });
    expect(wider?.key).not.toBe(key);

    await refreshFindings(APP_LOG);
    expect(findingsOf(get(findingsByFile), APP_LOG).fileSummary?.n).toBe(1);
    expect(requestOf(640)?.key).not.toBe(key);
  });

  it('asks nothing on a backend without signatures, for a chain, or with nothing picked', async () => {
    await serve(new FindingsBackend({ features: [] }));
    expect(requestOf(640)).toBeNull();

    await serve(new FindingsBackend());
    expect(requestOf(640, undefined, 'chain:/logs/app.log')).toBeNull();
    settings.update((s) => ({ ...s, findingsPicker: [] }));
    expect(requestOf(640)).toBeNull();
  });

  it('asks nothing for a file the tree lists without findings', async () => {
    const backend = await serve(new FindingsBackend());
    backend.addFile(APP_LOG, [], []);
    await tree.loadRoots();
    await tree.toggleExpanded(FINDINGS_DIR);

    expect(tree.nodeAt(APP_LOG)?.findings).toBeNull();
    expect(requestOf(640)).toBeNull();
  });
});

describe('openTickFinding', () => {
  it("opens the first finding of the tick's signatures from the line, as a click in the list does", async () => {
    const backend = await serve(new FindingsBackend());
    // An SQL statement on line 120 would come first in the list: it ends sooner.
    backend.addFile(
      APP_LOG,
      [
        finding('sql-statement', 40),
        finding('sql-statement', 120),
        finding('python-traceback', 120, 134),
      ],
      TEST_DEFAULT_IDS,
    );
    const opening = files.openFile(APP_LOG);
    await settle();
    await opening;

    const done = openTickFinding(APP_LOG, 120, ['python-traceback']);
    await settle();
    await done;

    const [query] = backend
      .requestsTo('GET', '/v1/findings')
      .map((r) => r.query)
      .filter((q) => q.has('after_line'));
    expect(query.get('after_line')).toBe('119');
    expect(query.getAll('signature')).toEqual(['python-traceback']);
    expect(query.get('limit')).toBe('1');
    const tab = get(files).openFiles.find((f) => f.path === APP_LOG);
    expect(tab?.selectedLines).toEqual([{ start: 120, end: 134 }]);
    expect(tab?.anchorLine).toBe(120);
    expect(findingsOf(get(findingsByFile), APP_LOG).currentId).not.toBeNull();
  });
});
