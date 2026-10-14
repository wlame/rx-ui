// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { files, health, notifications, settings, tree } from '$lib/stores';
import { commandLog } from '$lib/stores/commands';
import { forgetFindings } from '$lib/stores/findings';
import { closeFolderTaskRequest, startFolderTask } from '$lib/stores/folderTasks';
import { modalOpen, sidebarTab } from '$lib/stores/layout';
import { loadSignatures } from '$lib/stores/signatures';
import {
  APP_LOG,
  CORE_BIN,
  FOLDER,
  FolderTaskBackend,
  folderResult,
  serveFolderTasks,
} from '$lib/testing/fakeFolderTasks';
import CommandLine from '../layout/CommandLine.svelte';
import FileTree from './FileTree.svelte';
import FolderTaskDialog from './FolderTaskDialog.svelte';

const POLL_INTERVAL = 1000;

let mounted: (FileTree | FolderTaskDialog | CommandLine)[] = [];
let backend: FolderTaskBackend;

/**
 * The files panel, the dialog the app draws over it and the status bar's
 * equivalent command, over a backend listing `/logs`.
 */
async function mount(features?: string[]) {
  backend = new FolderTaskBackend({ features });
  serveFolderTasks(backend);
  await health.check();
  await loadSignatures();
  await tree.loadRoots();
  const target = document.body.appendChild(document.createElement('div'));
  mounted = [
    new FileTree({ target }),
    new FolderTaskDialog({ target: document.body }),
    new CommandLine({ target: document.body }),
  ];
  await tick();
  if (!rowOf(APP_LOG)) throw new Error('the files panel does not list app.log');
  return target;
}

function rowOf(path: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[role="treeitem"][data-row-id="${path}"]`);
}

/** Right-click the row of `path` and give the menu's items. */
async function openMenu(path: string): Promise<HTMLButtonElement[]> {
  rowOf(path)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await tick();
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
}

const labelsOf = (items: HTMLElement[]) => items.map((item) => item.textContent?.trim());

/** Close the open menu as a click beside it does. */
async function closeMenu() {
  document.querySelector<HTMLElement>('.fixed.inset-0.z-40')?.click();
  await tick();
}

async function choose(path: string, label: string) {
  const item = (await openMenu(path)).find((i) => i.textContent?.trim() === label);
  if (!item) throw new Error(`the menu of ${path} has no ${label}`);
  item.click();
  await vi.advanceTimersByTimeAsync(0);
  await tick();
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
}

function escape(): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  });
}

function dialogButton(label: string): HTMLButtonElement {
  const button = [...(dialog()?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!button) throw new Error(`the dialog has no ${label} button`);
  return button;
}

/** Let the polls and the stubbed requests settle, one poll interval at a time. */
async function settle(intervals = 2) {
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < intervals; i++) await vi.advanceTimersByTimeAsync(POLL_INTERVAL);
  await tick();
}

function footer(): string | undefined {
  return document.querySelector('code')?.textContent?.trim();
}

function folderLabel(): string | undefined {
  return rowOf(FOLDER)?.querySelector('[data-folder-task]')?.textContent?.trim();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  for (const task of backend?.tasks.values() ?? []) {
    if (task.status === 'queued' || task.status === 'running') backend.complete(task.id);
  }
  await settle();
  for (const component of mounted) component.$destroy();
  mounted = [];
  closeFolderTaskRequest();
  forgetFindings([]);
  for (const file of get(files).openFiles) files.closeFile(file.path);
  for (const n of get(notifications)) notifications.dismiss(n.id);
  settings.update((s) => ({ ...s, findingsPicker: null }));
  sidebarTab.set('tree');
  commandLog.clear();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the menu of each row kind', () => {
  it('offers Index all files and Scan all files for findings on a folder', async () => {
    await mount();

    expect(labelsOf(await openMenu(FOLDER))).toEqual([
      'Index all files',
      'Scan all files for findings',
    ]);
  });

  it('offers Scan for findings and Index on a text file, and nothing on a binary one', async () => {
    await mount();

    expect(labelsOf(await openMenu(APP_LOG))).toEqual(['Scan for findings', 'Index']);
    await closeMenu();
    expect(labelsOf(await openMenu(CORE_BIN))).toEqual([]);
  });

  it('offers only Index all files on a backend without signatures', async () => {
    await mount([]);

    expect(labelsOf(await openMenu(FOLDER))).toEqual(['Index all files']);
  });
});

describe('a folder task from the menu', () => {
  it('asks first, in a dialog that names the folder, and starts nothing before Scan', async () => {
    await mount();

    await choose(FOLDER, 'Scan all files for findings');

    expect(dialog()?.querySelector('h2')?.textContent?.trim()).toBe('Scan every file under logs/?');
    expect(get(modalOpen)).toBe(true);
    expect(backend.requests.filter((r) => r.method === 'POST')).toEqual([]);

    dialogButton('Cancel').click();
    await tick();

    expect(dialog()).toBeNull();
    expect(backend.requests.filter((r) => r.method === 'POST')).toEqual([]);
  });

  it.each([
    ['Esc', () => dialogButton('Index').dispatchEvent(escape())],
    ['Cancel', () => dialogButton('Cancel').click()],
    ['Index', () => dialogButton('Index').click()],
  ])('gives the focus back to the folder row after %s closes the dialog', async (_how, close) => {
    await mount();
    await choose(FOLDER, 'Index all files');
    expect(document.activeElement).toBe(dialogButton('Index'));

    close();
    await settle(0);

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(rowOf(FOLDER));
  });

  it("scans on Scan, shows the folder's progress and puts the task's command in the footer", async () => {
    await mount();
    settings.update((s) => ({ ...s, findingsPicker: ['sql-statement'] }));

    await choose(FOLDER, 'Scan all files for findings');
    dialogButton('Scan').click();
    await settle(0);

    expect(dialog()).toBeNull();
    expect(backend.requestsTo('POST', '/v1/findings').map((r) => r.body)).toEqual([
      { path: FOLDER, signatures: 'sql-statement', force: false },
    ]);
    expect(footer()).toBe(`rx scan ${FOLDER} --recursive --signatures=sql-statement --hidden`);
    expect(folderLabel()).toBe('scanning…');

    backend.progress(backend.lastTask().id, 12, 214);
    await settle(1);

    expect(folderLabel()).toBe('scanning 12/214');
  });

  it('indexes on Index and shows indexing 3/40 on the folder', async () => {
    await mount();

    await choose(FOLDER, 'Index all files');
    dialogButton('Index').click();
    await settle(0);
    backend.progress(backend.lastTask().id, 3, 40);
    await settle(1);

    expect(backend.requestsTo('POST', '/v1/index').map((r) => r.body)).toEqual([
      { path: FOLDER, force: false, threshold: 0 },
    ]);
    expect(folderLabel()).toBe('indexing 3/40');
    expect(footer()).toBe(`rx index ${FOLDER} --recursive --threshold=0 --hidden`);
  });

  it('offers no Stop while the request that starts the task is on its way', async () => {
    await mount();

    void startFolderTask(FOLDER, 'index');

    expect(labelsOf(await openMenu(FOLDER))).toEqual([]);
    await settle(0);
    expect(labelsOf(await openMenu(FOLDER))).toEqual(['Stop']);
  });

  it("stops the task from the folder's menu with one DELETE", async () => {
    await mount();
    await choose(FOLDER, 'Index all files');
    dialogButton('Index').click();
    await settle(0);
    const task = backend.lastTask();
    backend.progress(task.id, 3, 40);
    await settle(1);

    expect(labelsOf(await openMenu(FOLDER))).toEqual(['Stop']);
    await closeMenu();
    await choose(FOLDER, 'Stop');
    await settle(0);

    expect(backend.requestsTo('DELETE', `/v1/tasks/${task.id}`)).toHaveLength(1);
    await settle();
    expect(folderLabel()).toBeUndefined();
    expect(get(notifications).map((n) => n.message)).toContain(
      'Stopped indexing logs/ after 3 of 40 files',
    );
  });

  it('updates the labels of the files under the folder when the task ends', async () => {
    await mount();
    await choose(FOLDER, 'Scan all files for findings');
    dialogButton('Scan').click();
    await settle(0);
    expect(rowOf(APP_LOG)?.querySelector('[data-findings-label]')).toBeNull();

    backend.setLabels(APP_LOG, { findings: { state: 'full', count: 4 } });
    backend.complete(
      backend.lastTask().id,
      folderResult({ files_total: 3, done: 2, skipped: 1, findings: 4 }),
    );
    await settle();

    expect(rowOf(APP_LOG)?.querySelector('[data-findings-label]')?.textContent?.trim()).toBe('4');
    expect(folderLabel()).toBeUndefined();
    expect(get(notifications).map((n) => n.message)).toContain(
      'Scanned 2 files under logs/, skipped 1',
    );
  });
});

describe('a folder task while the files list is read again', () => {
  it.each([
    ['Scan all files for findings', 'Scan', 'scanning 1/3'],
    ['Index all files', 'Index', 'indexing 1/3'],
  ])("keeps the folder's badge through a refresh after %s", async (item, button, label) => {
    await mount();
    await choose(FOLDER, item);
    dialogButton(button).click();
    await settle(0);
    backend.progress(backend.lastTask().id, 1, 3);
    await settle(1);
    const badge = rowOf(FOLDER)?.querySelector('[data-folder-task]');
    expect(folderLabel()).toBe(label);

    backend.setLabels(APP_LOG, { is_indexed: true, findings: { state: 'partial', count: 2 } });
    await tree.refreshOpenFolders();
    await tick();

    expect(folderLabel()).toBe(label);
    expect(rowOf(FOLDER)?.querySelector('[data-folder-task]')).toBe(badge);
    expect(rowOf(APP_LOG)?.querySelector('[data-findings-label]')?.textContent?.trim()).toBe('2');
  });
});

describe('a file task from the menu', () => {
  it("shows the index task's command in the footer when Index starts it", async () => {
    await mount();

    await choose(APP_LOG, 'Index');
    await settle(0);

    expect(backend.requestsTo('POST', '/v1/index').map((r) => r.body)).toEqual([
      { path: APP_LOG, force: false, threshold: 0 },
    ]);
    expect(footer()).toBe(`rx index ${APP_LOG} --threshold=0 --hidden`);
  });

  it("shows the scan task's command in the footer when Scan for findings starts it", async () => {
    await mount();
    settings.update((s) => ({ ...s, findingsPicker: ['sql-statement'] }));

    await choose(APP_LOG, 'Scan for findings');
    await settle(0);

    expect(footer()).toBe(`rx scan ${APP_LOG} --signatures=sql-statement --hidden`);
  });
});
