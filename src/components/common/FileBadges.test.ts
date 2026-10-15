// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { health } from '$lib/stores';
import { findingsByFile, forgetFindings, refreshFindings } from '$lib/stores/findings';
import { loadSignatures, signatures } from '$lib/stores/signatures';
import { FINDINGS_DIR, FindingsBackend, finding, serveFindings } from '$lib/testing/fakeFindings';
import type { FindingsLabel } from '$lib/utils/findingsLabel';
import FileBadges from './FileBadges.svelte';

const APP_LOG = `${FINDINGS_DIR}/app.log`;

let badges: FileBadges | null = null;

/** A backend that serves signatures, with the catalogue loaded: four default signatures. */
async function serve(backend = new FindingsBackend()) {
  serveFindings(backend);
  await health.check();
  await loadSignatures();
  return backend;
}

function mount(findings: FindingsLabel | null, path: string | null = APP_LOG) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  badges = new FileBadges({ target, props: { findings, path } });
  return target.querySelector<HTMLElement>('[data-findings-label]');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  badges?.$destroy();
  badges = null;
  forgetFindings([]);
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('FileBadges findings label', () => {
  it('draws a full file as a filled yellow label with its count', async () => {
    await serve();

    const label = mount({ state: 'full', count: 1_234 });

    expect(label?.textContent?.trim()).toBe('1,234');
    expect(label?.className).toContain('badge-warning');
    expect(label?.title).toBe('Scanned with all 4 default signatures: 1,234 findings.');
  });

  it('draws a partly scanned file as a yellow outline with its count', async () => {
    await serve();

    const label = mount({ state: 'partial', count: 7 });

    expect(label?.textContent?.trim()).toBe('7');
    expect(label?.className).not.toContain('badge-warning');
    expect(label?.className).toContain('border-gh-attention-emphasis');
    expect(label?.title).toBe(
      'Scanned with some of the 4 default signatures: 7 findings. Open Findings to scan the rest.',
    );
  });

  it('says K of M once the session read the summary of the file', async () => {
    const backend = await serve();
    backend.addFile(
      APP_LOG,
      [finding('sql-statement', 3), finding('sql-statement', 9)],
      ['sql-statement'],
    );
    await refreshFindings(APP_LOG);

    const label = mount({ state: 'partial', count: 2 });

    expect(label?.title).toBe(
      'Scanned with 1 of 4 default signatures: 2 findings. Open Findings to scan the rest.',
    );
  });

  it('draws nothing for a file without findings', async () => {
    await serve();

    expect(mount(null)).toBeNull();
  });
});

// A scan's progress updates the findings store about once a second; a
// tree of thousands of rows must not update each of them.
describe('FileBadges subscriptions', () => {
  it('reads the findings store and the catalogue only for a file with a findings label', () => {
    const findingsSubscribe = vi.spyOn(findingsByFile, 'subscribe');
    const catalogueSubscribe = vi.spyOn(signatures, 'subscribe');

    mount(null);
    expect(findingsSubscribe).not.toHaveBeenCalled();
    expect(catalogueSubscribe).not.toHaveBeenCalled();

    badges?.$destroy();
    mount({ state: 'full', count: 3 });
    expect(findingsSubscribe).toHaveBeenCalled();
    expect(catalogueSubscribe).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

/** The compression badge FileBadges draws for a file stored in `format`. */
function compressionBadge(format: string) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  badges = new FileBadges({
    target,
    props: { isCompressed: true, compressionFormat: format },
  });
  return target.querySelector<HTMLElement>('.badge-info');
}

describe('FileBadges compression badge', () => {
  it('names a systemd journal in the badge and its tooltip', () => {
    const badge = compressionBadge('journal');

    expect(badge?.textContent?.trim()).toBe('journal');
    expect(badge?.title).toBe('systemd journal');
  });

  it.each(['gzip', 'bz2', 'xz', 'zstd'])('keeps "Compressed file: %s" for a %s file', (format) => {
    const badge = compressionBadge(format);

    expect(badge?.textContent?.trim()).toBe(format);
    expect(badge?.title).toBe(`Compressed file: ${format}`);
  });
});
