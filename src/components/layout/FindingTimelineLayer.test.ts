// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { files, health } from '$lib/stores';
import { fileZones } from '$lib/stores/fileZones';
import { forgetFindings } from '$lib/stores/findings';
import { loadSignatures } from '$lib/stores/signatures';
import {
  FINDINGS_DIR,
  FindingsBackend,
  TEST_DEFAULT_IDS,
  finding,
  serveFindings,
} from '$lib/testing/fakeFindings';
import type { OpenFile, TimeRangeResponse } from '$lib/types';
import { fractionOf } from '$lib/utils/timeline';
import { RESIZE_WAIT_MS } from './FindingTimelineLayer.svelte';
import TimelineBar from './TimelineBar.svelte';

const APP_LOG = `${FINDINGS_DIR}/app.log`;
const HOUR_MS = 3_600_000;

/** The wall clock of app.log's first line, 2026-10-10 12:00:00, read as UTC. */
const WALL_START = Date.UTC(2026, 9, 10, 12, 0, 0);
/** app.log spans ten minutes. */
const SPAN_MS = 600_000;

/**
 * A traceback and an SQL statement at 12:05:00.500 and .700 (one column
 * on a 600 px track) and an SQL statement at 12:09:00.500, as app.log
 * writes them.
 */
const APP_FINDINGS = [
  finding('python-traceback', 120, 134, { time_ms: WALL_START + 300_500 }),
  finding('sql-statement', 200, 200, { time_ms: WALL_START + 300_700 }),
  finding('sql-statement', 900, 900, { time_ms: WALL_START + 540_500 }),
];

/** app.log's time range read in `zone` (`+HH:MM` ahead of UTC): its instants come earlier. */
function rangeIn(zone: string, aheadMs: number): TimeRangeResponse {
  return {
    path: APP_LOG,
    format: 'iso',
    has_zone: false,
    day_first: null,
    display_zone: zone,
    example: '2026-10-10 12:00:04',
    first_ms: WALL_START - aheadMs,
    last_ms: WALL_START + SPAN_MS - aheadMs,
    source: 'scan',
    cli_command: `rx time-range ${APP_LOG}`,
  };
}

function openFile(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    path: APP_LOG,
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
    syntaxHighlighting: true,
    fileSize: 1000,
    regexFilter: null,
    showInvisibleChars: false,
    wordWrap: false,
    isIndexed: true,
    selectedLines: [],
    anchorLine: 1,
    indexBuild: null,
    fileType: null,
    pendingIndex: null,
    backgroundIndexBuild: null,
    timeRange: rangeIn('UTC', 0),
    isReadingTimeRange: false,
    timeJump: null,
    ...overrides,
  };
}

/** The width the layout gives the track; jsdom lays nothing out. */
const track = { px: 600 };

let bar: TimelineBar | null = null;

async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 3; i++) await tick();
  await vi.advanceTimersByTimeAsync(0);
}

/** A backend holding app.log's findings over its ten minutes. */
async function serve(): Promise<FindingsBackend> {
  const backend = new FindingsBackend({
    features: ['signatures', 'samples_timestamps', 'file_tz'],
  });
  backend.addFile(APP_LOG, APP_FINDINGS, TEST_DEFAULT_IDS);
  backend.setTimeRange(APP_LOG, WALL_START, WALL_START + SPAN_MS);
  serveFindings(backend);
  await health.check();
  await loadSignatures();
  return backend;
}

async function mount(props: { activeFile: OpenFile; canJump?: boolean }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  bar = new TimelineBar({
    target,
    props: { canJump: true, cursorMs: null, jump: vi.fn(), ...props },
  });
  await settle();
  return target;
}

function ticksRequests(backend: FindingsBackend): URLSearchParams[] {
  return backend
    .requestsTo('GET', '/v1/findings')
    .map((request) => request.query)
    .filter((query) => query.has('ticks'));
}

function drawnTicks(target: HTMLElement): HTMLElement[] {
  return [...target.querySelectorAll<HTMLElement>('[data-finding-tick]')];
}

beforeEach(() => {
  vi.useFakeTimers();
  track.px = 600;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-finding-ticks') ? track.px : 0;
    },
  });
});

afterEach(async () => {
  bar?.$destroy();
  bar = null;
  for (const file of get(files).openFiles) files.closeFile(file.path);
  fileZones.clear(APP_LOG);
  forgetFindings([]);
  // The next test file starts from a backend that serves nothing.
  serveFindings(new FindingsBackend({ features: [] }));
  await health.check();
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('the ticks of the findings on the timeline', () => {
  it('asks for one column per pixel of the track, and draws a tick per group per column', async () => {
    const backend = await serve();

    const target = await mount({ activeFile: openFile() });

    const [query] = ticksRequests(backend);
    expect(query.get('ticks')).toBe('600');
    expect(query.get('limit')).toBe('1');
    expect(query.has('file_tz')).toBe(false);
    expect(drawnTicks(target).map((t) => t.dataset.group)).toEqual(['traceback', 'sql', 'sql']);
    expect(drawnTicks(target)[0].title).toBe(
      '2 findings at 2026-10-10 12:05:00: python-traceback ×1, sql-statement ×1',
    );
  });

  it("opens the column's first finding on a click, as a click in the list does", async () => {
    const backend = await serve();
    const opening = files.openFile(APP_LOG);
    await settle();
    await opening;
    const target = await mount({ activeFile: openFile() });

    drawnTicks(target)[1].click();
    await settle();

    const opened = backend
      .requestsTo('GET', '/v1/findings')
      .map((request) => request.query)
      .find((query) => query.has('after_line'));
    expect(opened?.get('after_line')).toBe('119');
    const tab = get(files).openFiles.find((file) => file.path === APP_LOG);
    expect(tab?.selectedLines).toEqual([{ start: 120, end: 134 }]);
  });

  it('asks again once the resized track keeps its new width', async () => {
    const backend = await serve();
    await mount({ activeFile: openFile() });

    track.px = 800;
    window.dispatchEvent(new Event('resize'));
    await settle(RESIZE_WAIT_MS - 1);
    expect(ticksRequests(backend)).toHaveLength(1);

    await settle(1);
    expect(ticksRequests(backend).map((query) => query.get('ticks'))).toEqual(['600', '800']);
  });

  it.each([
    ['a backend without time queries', { activeFile: openFile(), canJump: false }],
    ['a file without timestamps', { activeFile: openFile({ timeRange: null }) }],
  ])('asks nothing while the timeline is hidden: %s', async (_name, props) => {
    const backend = await serve();

    const target = await mount(props);

    expect(target.querySelector('[role="slider"]')).toBeNull();
    expect(ticksRequests(backend)).toEqual([]);
  });

  it('draws nothing, and says nothing, for a file the backend has no time range for', async () => {
    const backend = await serve();
    backend.addFile(APP_LOG, APP_FINDINGS, TEST_DEFAULT_IDS);

    const target = await mount({ activeFile: openFile() });

    expect(ticksRequests(backend)).toHaveLength(1);
    expect(drawnTicks(target)).toEqual([]);
  });

  // Review focus 4: a file read in a zone of its own. The axis spans the
  // file's times read in that zone; the ticks must span the same instants.
  it('Review focus 4: asks in the zone chosen for the file, and puts a tick where the axis prints its time', async () => {
    const backend = await serve();
    fileZones.set(APP_LOG, '+02:00', () => true);
    const inZone = openFile({ timeRange: rangeIn('+02:00', 2 * HOUR_MS) });

    const target = await mount({ activeFile: inZone });

    const [query] = ticksRequests(backend);
    expect(query.get('file_tz')).toBe('+02:00');
    // The SQL statement written at 12:09:00.500 is the instant 10:09:00.500 UTC.
    const axis = { startMs: WALL_START - 2 * HOUR_MS, endMs: WALL_START + SPAN_MS - 2 * HOUR_MS };
    const written = WALL_START + 540_500 - 2 * HOUR_MS;
    const tick = drawnTicks(target).at(-1);
    const left = parseFloat(tick?.style.left ?? 'NaN') / 100;
    expect(Math.abs(left - fractionOf(written, axis))).toBeLessThanOrEqual(1 / 600);
    expect(tick?.title).toBe('1 finding at 2026-10-10 12:09:00: sql-statement ×1');
  });
});
