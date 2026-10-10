// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { health, tree } from '$lib/stores';
import { forgetFindings, refreshFindings } from '$lib/stores/findings';
import { loadSignatures } from '$lib/stores/signatures';
import { chainDescription, chainPart, chainTabOf } from '$lib/testing/chainDescription';
import {
  FINDINGS_DIR,
  FindingsBackend,
  TEST_DEFAULT_IDS,
  finding,
  serveFindings,
} from '$lib/testing/fakeFindings';
import type { OpenFile } from '$lib/types';
import EditorHeader from './EditorHeader.svelte';

const APP_LOG = `${FINDINGS_DIR}/app.log`;

let header: EditorHeader | null = null;

/** A tab of `path` with one line loaded. */
function openFile(path: string, overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    lines: [{ lineNumber: 1, content: 'LINE 1' }],
    totalLines: 1,
    startLine: 1,
    endLine: 1,
    loading: false,
    error: null,
    isCompressed: false,
    compressionFormat: null,
    reachedStart: true,
    reachedEnd: true,
    syntaxHighlighting: false,
    fileSize: 100,
    regexFilter: null,
    showInvisibleChars: false,
    wordWrap: false,
    selectedLines: [],
    isIndexed: false,
    anchorLine: 1,
    indexBuild: null,
    fileType: null,
    pendingIndex: null,
    backgroundIndexBuild: null,
    timeRange: null,
    isReadingTimeRange: false,
    timeJump: null,
    ...overrides,
  };
}

/** A backend that serves signatures and holds three findings of the default set in `app.log`. */
async function serve() {
  const backend = new FindingsBackend();
  const found = [
    finding('python-traceback', 1),
    finding('sql-statement', 2),
    finding('sql-statement', 3),
  ];
  backend.addFile(APP_LOG, found, TEST_DEFAULT_IDS);
  backend.listFindings(APP_LOG, { state: 'full', count: 3 });
  serveFindings(backend);
  await health.check();
  await loadSignatures();
  return backend;
}

async function mount(file: OpenFile) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  header = new EditorHeader({ target, props: { file, monacoTheme: 'vs' } });
  await tick();
  return () => target.querySelector<HTMLElement>('[data-findings-label]');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  header?.$destroy();
  header = null;
  forgetFindings([]);
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('EditorHeader findings label', () => {
  it('shows the label the tree lists for the file', async () => {
    await serve();
    await tree.loadRoots();
    await tree.expand(FINDINGS_DIR);

    const label = await mount(openFile(APP_LOG));

    expect(label()?.dataset.findingsLabel).toBe('full');
    expect(label()?.textContent?.trim()).toBe('3');
  });

  // A link can open a file in a folder the tree has not listed.
  it('shows the label of the summary the session read when the tree does not list the file', async () => {
    const backend = await serve();
    const other = `${FINDINGS_DIR}/deep/worker.log`;
    backend.addFile(other, [finding('email-address', 4)], ['email-address']);
    const label = await mount(openFile(other));
    expect(label()).toBeNull();

    await refreshFindings(other);
    await tick();

    expect(label()?.dataset.findingsLabel).toBe('partial');
    expect(label()?.textContent?.trim()).toBe('1');
  });

  it("shows no label in a log chain's tab", async () => {
    await serve();
    await tree.loadRoots();
    await tree.expand(FINDINGS_DIR);
    const description = chainDescription({
      state: 'pending',
      parts: [chainPart('app.log', { is_active: true })],
    });
    const lines = [{ lineNumber: 1, content: 'LINE 1', part: 'app.log', localLine: 1 }];

    const label = await mount(
      openFile(`chain:${APP_LOG}`, { lines, chain: chainTabOf(description) }),
    );

    expect(label()).toBeNull();
  });
});
