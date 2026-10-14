// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { files, health, settings, tree } from '$lib/stores';
import { findingsByFile, findingsOf, forgetFindings } from '$lib/stores/findings';
import { sidebarTab, sidebarVisible } from '$lib/stores/layout';
import { loadSignatures } from '$lib/stores/signatures';
import { FINDINGS_DIR, FindingsBackend, serveFindings } from '$lib/testing/fakeFindings';
import { scanForFindings } from './scanForFindings';

const APP_LOG = `${FINDINGS_DIR}/app.log`;

/** A backend that serves signatures, with the catalogue loaded and the tree listing `app.log`. */
async function serve() {
  const backend = new FindingsBackend();
  backend.addFile(APP_LOG, [], []);
  serveFindings(backend);
  await health.check();
  await loadSignatures();
  await tree.loadRoots();
  await tree.toggleExpanded(FINDINGS_DIR);
  return backend;
}

beforeEach(() => {
  vi.useFakeTimers();
  sidebarTab.set('tree');
});

afterEach(() => {
  forgetFindings([]);
  settings.update((s) => ({ ...s, findingsPicker: null }));
  for (const file of get(files).openFiles) files.closeFile(file.path);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('scanForFindings', () => {
  it("opens the file, shows the Findings panel and scans with the picker's choice", async () => {
    const backend = await serve();
    settings.update((s) => ({ ...s, findingsPicker: ['sql-statement', 'email-address'] }));

    void scanForFindings(APP_LOG);
    await vi.advanceTimersByTimeAsync(0);

    expect(get(files).openFiles.map((f) => f.path)).toEqual([APP_LOG]);
    expect(get(sidebarTab)).toBe('findings');
    expect(get(sidebarVisible)).toBe(true);
    const [scan] = backend.requestsTo('POST', '/v1/findings');
    expect(scan.body).toEqual({
      path: APP_LOG,
      signatures: 'sql-statement,email-address',
      force: false,
    });
    expect(findingsOf(get(findingsByFile), APP_LOG).scan).not.toBeNull();

    backend.complete(backend.lastTask()?.id ?? '');
    await vi.advanceTimersByTimeAsync(2000);
    expect(findingsOf(get(findingsByFile), APP_LOG).scan).toBeNull();
  });

  it('scans with the default set when the picker is left at Default', async () => {
    const backend = await serve();

    void scanForFindings(APP_LOG);
    await vi.advanceTimersByTimeAsync(0);

    // By name, so the task's command reads --signatures=default.
    const [scan] = backend.requestsTo('POST', '/v1/findings');
    expect(scan.body?.signatures).toBe('default');
    backend.complete(backend.lastTask()?.id ?? '');
    await vi.advanceTimersByTimeAsync(2000);
  });

  it('scans nothing when nothing is picked, and shows the panel that says so', async () => {
    const backend = await serve();
    settings.update((s) => ({ ...s, findingsPicker: [] }));

    await scanForFindings(APP_LOG);

    expect(get(sidebarTab)).toBe('findings');
    expect(backend.requestsTo('POST', '/v1/findings')).toEqual([]);
  });
});
