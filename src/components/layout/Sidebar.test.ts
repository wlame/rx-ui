// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { health, trace, tree } from '$lib/stores';
import {
  clickPanelButton,
  findingsFocusRequested,
  searchFocusRequested,
  shortcutsHelpOpen,
  sidebarTab,
  sidebarVisible,
  treeFocusRequested,
} from '$lib/stores/layout';
import { chainMode } from '$lib/stores/chainMode';
import { DEFAULT_FILES_VIEW, filesView } from '$lib/stores/filesView';
import { draftFromSearch, searchDraft } from '$lib/stores/searchDraft';
import { searchRequest } from '$lib/stores/trace';
import { LOG_ROOT, LogDirBackend, serveLogDir } from '$lib/testing/fakeLogDir';
import ModalDialogHarness from '$lib/testing/ModalDialogHarness.svelte';
import KeyboardShortcuts from '../common/KeyboardShortcuts.svelte';
import Sidebar from './Sidebar.svelte';

let mounted: (Sidebar | KeyboardShortcuts | ModalDialogHarness)[] = [];

/** The side panel and the window's key handler, over a backend with one search root. */
async function mount(backend = new LogDirBackend({ features: [] })) {
  serveLogDir(backend);
  await health.check();
  await tree.loadRoots();
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = [
    new Sidebar({ target, props: { width: 300 } }),
    new KeyboardShortcuts({ target: document.body }),
  ];
  await tick();
  return {
    target,
    pattern: () => target.querySelector<HTMLInputElement>('input[aria-label="Regex pattern 1"]'),
    tree: () => target.querySelector<HTMLElement>('[role="tree"]'),
    firstRow: () => target.querySelector<HTMLElement>('[role="treeitem"]'),
  };
}

async function typeValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
}

/** Press a key on a control outside the side panel, then let the focus requests run. */
async function pressAnywhere(init: KeyboardEventInit) {
  const elsewhere = document.body.appendChild(document.createElement('button'));
  elsewhere.focus();
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  elsewhere.dispatchEvent(event);
  await tick();
  await tick();
  await tick();
  return event;
}

afterEach(() => {
  for (const component of mounted) component.$destroy();
  mounted = [];
  sidebarTab.set('tree');
  sidebarVisible.set(true);
  shortcutsHelpOpen.set(false);
  treeFocusRequested.set(false);
  searchFocusRequested.set(false);
  findingsFocusRequested.set(false);
  searchRequest.set(null);
  searchDraft.set(draftFromSearch(null));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('the side panel', () => {
  it('keeps every panel in the page and hides the ones not shown', async () => {
    const { pattern, tree: fileTree } = await mount();

    expect(fileTree()?.closest('[hidden]')).toBeNull();
    expect(pattern()?.closest('[hidden]')).not.toBeNull();

    clickPanelButton('search');
    await tick();

    expect(fileTree()).not.toBeNull();
    expect(fileTree()?.closest('[hidden]')).not.toBeNull();
    expect(pattern()?.closest('[hidden]')).toBeNull();
  });

  it('keeps the unsent search pattern when Files is shown and then Search again', async () => {
    const { pattern } = await mount();
    clickPanelButton('search');
    await tick();
    const field = pattern();
    if (!field) throw new Error('the pattern field is not rendered');
    await typeValue(field, 'ERROR [0-9]+');

    clickPanelButton('tree');
    await tick();
    clickPanelButton('search');
    await tick();

    expect(pattern()).toBe(field);
    expect(field.value).toBe('ERROR [0-9]+');
  });

  it('keeps an unsent pattern, a match toggle and the max when Files is shown and then Search', async () => {
    const { target, pattern } = await mount(
      new LogDirBackend({ features: ['trace_matching_flags'] }),
    );
    clickPanelButton('search');
    await tick();
    const field = pattern();
    const maxBox = target.querySelector<HTMLInputElement>('input[aria-label="Most matches"]');
    const matchCase = target.querySelector<HTMLButtonElement>('button[aria-label="Match case"]');
    if (!field || !maxBox || !matchCase) throw new Error('the search form is not rendered');
    await typeValue(field, 'timeout [0-9]+');
    matchCase.click();
    await typeValue(maxBox, '50');

    clickPanelButton('tree');
    await tick();
    clickPanelButton('search');
    await tick();

    expect(field.value).toBe('timeout [0-9]+');
    expect(matchCase.getAttribute('aria-pressed')).toBe('false');
    expect(maxBox.value).toBe('50');
    expect(get(searchDraft)).toMatchObject({
      patterns: ['timeout [0-9]+'],
      toggles: { matchCase: false },
      maxResults: '50',
    });
  });

  // The search panel is mounted while Files is shown, so a link that
  // names a search and `tab=files` runs it on load, as with `tab=search`.
  it("runs a link's search on load while Files is shown", async () => {
    const search = vi.spyOn(trace, 'search').mockResolvedValue(null);
    searchRequest.set({ patterns: ['ERROR'], maxResults: 100, onlyOpenedFiles: false, flags: {} });

    await mount();

    expect(get(sidebarTab)).toBe('tree');
    expect(search).toHaveBeenCalledWith([LOG_ROOT], ['ERROR'], { maxResults: 100, flags: {} });
  });

  it('is not drawn while hidden, and keeps its panels', async () => {
    const { target, pattern } = await mount();
    const aside = target.querySelector('aside');

    sidebarVisible.set(false);
    await tick();

    expect(aside?.style.display).toBe('none');
    expect(pattern()).not.toBeNull();
  });
});

describe('the panel keys over the side panel', () => {
  it('Alt+2 shows a hidden side panel on Search and focuses the first pattern field', async () => {
    const { pattern } = await mount();
    sidebarVisible.set(false);
    await tick();

    const event = await pressAnywhere({ key: '™', code: 'Digit2', altKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(get(sidebarVisible)).toBe(true);
    expect(pattern()?.closest('[hidden]')).toBeNull();
    expect(document.activeElement).toBe(pattern());
    expect(get(searchFocusRequested)).toBe(false);
  });

  // A Mac sends "£" for Option+3.
  it('Alt+3 shows a hidden side panel on Findings and takes the focus into it', async () => {
    const { target } = await mount();
    sidebarVisible.set(false);
    await tick();

    const event = await pressAnywhere({ key: '£', code: 'Digit3', altKey: true });

    const panel = target.querySelector<HTMLElement>('[data-findings-panel]');
    expect(event.defaultPrevented).toBe(true);
    expect(get(sidebarVisible)).toBe(true);
    expect(get(sidebarTab)).toBe('findings');
    expect(panel?.closest('[hidden]')).toBeNull();
    expect(panel?.contains(document.activeElement)).toBe(true);
    expect(get(findingsFocusRequested)).toBe(false);
  });

  it('Alt+3 does nothing while a modal dialog is open', async () => {
    await mount();
    mounted.push(new ModalDialogHarness({ target: document.body }));

    const event = await pressAnywhere({ key: '£', code: 'Digit3', altKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(get(sidebarTab)).toBe('tree');
  });

  it('Alt+1 shows Files and focuses the first row of the tree', async () => {
    const { firstRow } = await mount();
    sidebarTab.set('search');
    await tick();

    const event = await pressAnywhere({ key: '¡', code: 'Digit1', altKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(get(sidebarTab)).toBe('tree');
    expect(firstRow()?.textContent).toContain(LOG_ROOT.slice(1));
    expect(document.activeElement).toBe(firstRow());
    expect(get(treeFocusRequested)).toBe(false);
  });
});

/** Press a key on `element`, then let the reactive updates run. */
async function keyDown(element: HTMLElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  await tick();
  await tick();
  return event;
}

/**
 * The files panel's keys belong to it only while it is shown and no
 * dialog owns the keyboard; otherwise they change nothing and the key is
 * left to the browser.
 */
describe('the files panel keys while something else owns the keyboard', () => {
  const FILES_KEYS: [string, KeyboardEventInit][] = [
    ['Alt+G', { key: '©', code: 'KeyG', altKey: true }],
    ['Alt+L', { key: '¬', code: 'KeyL', altKey: true }],
    ['Alt+V', { key: '√', code: 'KeyV', altKey: true }],
    // Option+N is a dead key on a Mac's US layout.
    ['Alt+N', { key: 'Dead', code: 'KeyN', altKey: true }],
    ['Alt+S', { key: 'ß', code: 'KeyS', altKey: true }],
  ];

  afterEach(() => {
    chainMode.set(false);
    filesView.set(DEFAULT_FILES_VIEW);
  });

  function expectNothingChanged(event: KeyboardEvent) {
    expect(event.defaultPrevented).toBe(false);
    expect(get(chainMode)).toBe(false);
    expect(get(filesView)).toEqual(DEFAULT_FILES_VIEW);
  }

  it.each(FILES_KEYS)('%s acts while Files is shown', async (_name, init) => {
    await mount(new LogDirBackend({ features: ['log_chains'] }));

    const event = await pressAnywhere(init);

    expect(event.defaultPrevented).toBe(true);
  });

  it.each(FILES_KEYS)(
    '%s does nothing from the pattern field while Search is shown',
    async (_name, init) => {
      const { pattern } = await mount(new LogDirBackend({ features: ['log_chains'] }));
      clickPanelButton('search');
      await tick();
      const field = pattern();
      if (!field) throw new Error('the pattern field is not rendered');
      field.focus();

      expectNothingChanged(await keyDown(field, init));
    },
  );

  it.each(FILES_KEYS)('%s does nothing while the side panel is hidden', async (_name, init) => {
    await mount(new LogDirBackend({ features: ['log_chains'] }));
    sidebarVisible.set(false);
    await tick();

    expectNothingChanged(await pressAnywhere(init));
  });

  it.each(FILES_KEYS)('%s does nothing while the shortcut list is open', async (_name, init) => {
    await mount(new LogDirBackend({ features: ['log_chains'] }));
    shortcutsHelpOpen.set(true);
    await tick();

    expectNothingChanged(await pressAnywhere(init));
  });

  it.each(FILES_KEYS)('%s does nothing while a modal dialog is open', async (_name, init) => {
    await mount(new LogDirBackend({ features: ['log_chains'] }));
    mounted.push(new ModalDialogHarness({ target: document.body }));
    const closeButton = document.querySelector<HTMLButtonElement>(
      '[aria-modal="true"] button[aria-label="Close"]',
    );
    if (!closeButton) throw new Error('the dialog is not rendered');
    closeButton.focus();

    expectNothingChanged(await keyDown(closeButton, init));
    expect(document.activeElement).toBe(closeButton);
  });

  it('leaves Alt+G of an input method alone', async () => {
    await mount(new LogDirBackend({ features: ['log_chains'] }));

    expectNothingChanged(
      await pressAnywhere({ key: '©', code: 'KeyG', altKey: true, isComposing: true }),
    );
  });

  it('leaves Alt+G to the browser on a backend without log chains', async () => {
    await mount(new LogDirBackend({ features: [] }));

    expectNothingChanged(await pressAnywhere({ key: '©', code: 'KeyG', altKey: true }));
  });
});

/**
 * The search panel's keys belong to it only while the focus is inside
 * it; from the file tree they change nothing and are left to the browser.
 */
describe('the search panel keys with the focus in the file tree', () => {
  it.each([
    ['Alt+C', { key: 'ç', code: 'KeyC', altKey: true }],
    ['Alt+O', { key: 'ø', code: 'KeyO', altKey: true }],
  ])('%s does nothing and is not cancelled', async (_name, init) => {
    const { firstRow } = await mount(new LogDirBackend({ features: ['trace_matching_flags'] }));
    const row = firstRow();
    if (!row) throw new Error('the tree has no row');
    row.focus();

    const event = await keyDown(row, init);

    expect(event.defaultPrevented).toBe(false);
    expect(get(searchDraft)).toEqual(draftFromSearch(null));
  });
});
