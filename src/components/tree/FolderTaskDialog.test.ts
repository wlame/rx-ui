// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { health, settings } from '$lib/stores';
import {
  askFolderTask,
  closeFolderTaskRequest,
  folderTaskOf,
  folderTaskRequest,
} from '$lib/stores/folderTasks';
import { modalOpen } from '$lib/stores/layout';
import { loadSignatures } from '$lib/stores/signatures';
import { FOLDER, FolderTaskBackend, serveFolderTasks } from '$lib/testing/fakeFolderTasks';
import FolderTaskDialog from './FolderTaskDialog.svelte';

let mounted: FolderTaskDialog | null = null;
let backend: FolderTaskBackend;

async function mount() {
  backend = new FolderTaskBackend();
  serveFolderTasks(backend);
  await health.check();
  await loadSignatures();
  mounted = new FolderTaskDialog({ target: document.body });
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
}

function button(label: string): HTMLButtonElement | undefined {
  return [...(dialog()?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent?.trim() === label,
  );
}

afterEach(() => {
  mounted?.$destroy();
  mounted = null;
  closeFolderTaskRequest();
  settings.update((s) => ({ ...s, findingsPicker: null }));
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('FolderTaskDialog', () => {
  it('draws nothing while no folder task is asked for', async () => {
    await mount();

    expect(dialog()).toBeNull();
    expect(get(modalOpen)).toBe(false);
  });

  it('asks to index every file under the folder, with the focus on Index', async () => {
    await mount();

    await askFolderTask(FOLDER, 'index');
    await tick();

    expect(dialog()?.querySelector('h2')?.textContent?.trim()).toBe(
      'Index every file under logs/?',
    );
    expect(dialog()?.textContent).toContain(FOLDER);
    expect(document.activeElement).toBe(button('Index'));
    expect(get(modalOpen)).toBe(true);
  });

  it('says how many signatures the scan uses', async () => {
    await mount();
    settings.update((s) => ({ ...s, findingsPicker: ['sql-statement', 'aws-access-key'] }));

    await askFolderTask(FOLDER, 'findings');
    await tick();

    expect(dialog()?.querySelector('h2')?.textContent?.trim()).toBe('Scan every file under logs/?');
    expect(dialog()?.textContent).toContain('the 2 signatures the Findings panel picks');
  });

  it('closes on Esc and starts nothing', async () => {
    await mount();
    await askFolderTask(FOLDER, 'index');
    await tick();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    button('Index')?.dispatchEvent(event);
    await tick();

    expect(event.defaultPrevented).toBe(true);
    expect(dialog()).toBeNull();
    expect(get(folderTaskRequest)).toBeNull();
    expect(get(modalOpen)).toBe(false);
    expect(backend.requests.filter((r) => r.method === 'POST')).toEqual([]);
  });

  it('closes on a click beside it and starts nothing', async () => {
    await mount();
    await askFolderTask(FOLDER, 'index');
    await tick();

    document.querySelector<HTMLElement>('[aria-label="Close dialog"]')?.click();
    await tick();

    expect(dialog()).toBeNull();
    expect(backend.requests.filter((r) => r.method === 'POST')).toEqual([]);
  });

  it('starts the task and closes on Index', async () => {
    vi.useFakeTimers();
    await mount();
    await askFolderTask(FOLDER, 'index');
    await tick();

    button('Index')?.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(dialog()).toBeNull();
    expect(backend.requestsTo('POST', '/v1/index').map((r) => r.body)).toEqual([
      { path: FOLDER, force: false, threshold: 0 },
    ]);
    backend.complete(backend.lastTask().id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(folderTaskOf(FOLDER)).toBeNull();
    vi.useRealTimers();
  });
});

describe('the app', () => {
  // A tree row only names the folder in the store; without the dialog in
  // the app, the folder items would do nothing. The shortcut list opens
  // over it, so it comes first.
  it('draws the folder task dialog, before the shortcut list that opens over it', () => {
    const app = readFileSync(resolve(__dirname, '../../App.svelte'), 'utf-8');
    const dialogAt = app.indexOf('<FolderTaskDialog />');

    expect(dialogAt).toBeGreaterThan(-1);
    expect(dialogAt).toBeLessThan(app.indexOf('<KeyboardShortcuts />'));
  });
});
