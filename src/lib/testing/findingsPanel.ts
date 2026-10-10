/**
 * Mounting the findings panel for a component test: over a
 * `FindingsBackend`, with the catalogue loaded, the tree listing the
 * backend's files, the given files open (the last one active) and the
 * Findings panel shown. Tests run with fake timers; `settle` advances
 * them and lets the updates they cause run.
 */
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { vi } from 'vitest';
import FindingsPanel from '../../components/findings/FindingsPanel.svelte';
import { files, health, settings, tree } from '../stores';
import { chainMode } from '../stores/chainMode';
import { findingsFilter, forgetFindings } from '../stores/findings';
import { findingsBy, findingsFocusRequested, sidebarTab, sidebarVisible } from '../stores/layout';
import { loadSignatures } from '../stores/signatures';
import { FINDINGS_DIR, FindingsBackend, serveFindings } from './fakeFindings';

export const APP_LOG = `${FINDINGS_DIR}/app.log`;
export const WORKER_LOG = `${FINDINGS_DIR}/worker.log`;

/** How often a scan's task is asked for its status. */
export const POLL_INTERVAL_MS = 1000;

let mounted: FindingsPanel[] = [];
let lastBackend: FindingsBackend | null = null;

/** Advance the fake timers by `ms`, then let the updates the timers and requests caused run. */
export async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 4; i++) await tick();
  await vi.advanceTimersByTimeAsync(0);
  await tick();
}

/** The findings panel over `backend`, with `open` files open, the last one active. */
export async function mountFindingsPanel(
  backend: FindingsBackend,
  open: string[] = [],
): Promise<HTMLElement> {
  lastBackend = backend;
  serveFindings(backend);
  await health.check();
  await loadSignatures();
  await tree.loadRoots();
  await tree.toggleExpanded(FINDINGS_DIR);
  for (const path of open) void files.openFile(path);
  sidebarTab.set('findings');
  sidebarVisible.set(true);
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted.push(new FindingsPanel({ target }));
  await settle();
  return target;
}

/**
 * Complete every scan the last backend still runs, and let the store
 * follow each to its end: a scan is followed by the findings store, which
 * outlives a test, and one left running would hold its file's scan.
 */
export async function finishScans(): Promise<void> {
  for (const task of lastBackend?.unfinishedTasks() ?? []) lastBackend?.complete(task.id);
  await settle(POLL_INTERVAL_MS);
  await settle(POLL_INTERVAL_MS);
}

/** Destroy the panels and put every store the panel uses back. */
export function unmountFindingsPanels(): void {
  for (const panel of mounted) panel.$destroy();
  mounted = [];
  for (const file of get(files).openFiles) files.closeFile(file.path);
  forgetFindings([]);
  findingsFilter.set('');
  findingsBy.set('line');
  findingsFocusRequested.set(false);
  settings.update((s) => ({ ...s, findingsPicker: null }));
  sidebarTab.set('tree');
  sidebarVisible.set(true);
  chainMode.set(false);
  lastBackend = null;
  document.body.replaceChildren();
}

/** The button inside `root` whose text or label is `name`. */
export function buttonNamed(root: ParentNode, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === name || button.getAttribute('aria-label') === name,
  );
  if (!found) throw new Error(`no button "${name}"`);
  return found;
}

/** Press a key on `element`, then let the updates run. */
export async function keyDown(element: Element, init: KeyboardEventInit): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  await settle();
  return event;
}

/** Click `element`, then let the updates run. */
export async function click(element: HTMLElement): Promise<void> {
  element.click();
  await settle();
}

/** Type `value` into a text field as the user does, then let the updates run. */
export async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}
