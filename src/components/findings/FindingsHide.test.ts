// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { files, settings } from '$lib/stores';
import {
  markInputs,
  requestWindowFindings,
  stepFinding,
  windowFindings,
  windowFindingsOf,
} from '$lib/stores/editorFindings';
import { findingsFilter } from '$lib/stores/findings';
import { ticksRequestOf } from '$lib/stores/findingTicks';
import { findingsBy } from '$lib/stores/layout';
import { signatures } from '$lib/stores/signatures';
import { FindingsBackend, TEST_DEFAULT_IDS, finding } from '$lib/testing/fakeFindings';
import {
  APP_LOG,
  buttonNamed,
  click,
  finishScans,
  keyDown,
  mountFindingsPanel,
  settle,
  unmountFindingsPanels,
} from '$lib/testing/findingsPanel';
import { hoverTooltipText } from '$lib/testing/tooltipText';
import { findingDecorations } from '$lib/utils/editorDecorations';

/** Two tracebacks and an SQL statement in app.log. */
const APP_FINDINGS = [
  finding('python-traceback', 120, 121),
  finding('sql-statement', 200),
  finding('python-traceback', 402, 403),
];

/** The panel by group over app.log holding `found`, its `current` signatures scanned. */
async function mountByGroup(found = APP_FINDINGS, current = TEST_DEFAULT_IDS) {
  const backend = new FindingsBackend();
  backend.addFile(APP_LOG, found, current);
  findingsBy.set('group');
  const target = await mountFindingsPanel(backend, [APP_LOG]);
  return { backend, target };
}

function rowsOf(target: HTMLElement): HTMLElement[] {
  return [...target.querySelectorAll<HTMLElement>('[role="option"], [role="treeitem"]')];
}

function headerRow(target: HTMLElement, selector: string): HTMLElement {
  const row = target.querySelector<HTMLElement>(`[role="treeitem"]${selector}`);
  if (!row) throw new Error(`no row ${selector}`);
  return row;
}

const signatureRow = (target: HTMLElement, id: string) =>
  headerRow(target, `[data-signature="${id}"]`);
const groupRow = (target: HTMLElement, group: string) =>
  headerRow(target, `[data-group="${group}"]`);

/** The eye of a header row: the button that says whether its findings are shown. */
function eyeOf(row: HTMLElement): HTMLButtonElement {
  const eye = row.querySelector<HTMLButtonElement>('button[aria-pressed]');
  if (!eye) throw new Error('no eye on the row');
  return eye;
}

/** The state an eye shows: its `aria-pressed`, its icon and its label. */
function eyeState(row: HTMLElement) {
  const eye = eyeOf(row);
  return {
    pressed: eye.getAttribute('aria-pressed'),
    icon: eye.querySelector('svg')?.dataset.icon,
    label: eye.getAttribute('aria-label'),
  };
}

function pickerBox(target: HTMLElement, id: string): HTMLInputElement {
  const box = target.querySelector<HTMLInputElement>(
    `#findings-picker input[data-signature="${id}"]`,
  );
  if (!box) throw new Error(`no box of ${id}`);
  return box;
}

async function openPicker(target: HTMLElement) {
  const trigger = target.querySelector<HTMLButtonElement>(
    'button[aria-controls="findings-picker"]',
  );
  if (!trigger) throw new Error('no picker button');
  await click(trigger);
}

const WITHOUT_TRACEBACK = ['java-exception', 'aws-access-key', 'sql-statement'];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  await finishScans();
  unmountFindingsPanels();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the eye of a signature header', () => {
  it('unchecks the signature in the picker and the stored choice, and the picker shows it again', async () => {
    const { target } = await mountByGroup();
    expect(eyeState(signatureRow(target, 'python-traceback'))).toEqual({
      pressed: 'true',
      icon: 'eye',
      label: 'Hide the findings of Python traceback',
    });

    await click(eyeOf(signatureRow(target, 'python-traceback')));

    expect(get(settings).findingsPicker).toEqual(WITHOUT_TRACEBACK);
    await openPicker(target);
    expect(pickerBox(target, 'python-traceback').checked).toBe(false);
    expect(eyeState(signatureRow(target, 'python-traceback'))).toEqual({
      pressed: 'false',
      icon: 'eye-off',
      label: 'Show the findings of Python traceback',
    });

    await click(pickerBox(target, 'python-traceback'));

    expect(get(settings).findingsPicker).toBeNull();
    expect(eyeState(signatureRow(target, 'python-traceback'))).toMatchObject({
      pressed: 'true',
      icon: 'eye',
    });
  });
});

describe('the eye of a group header', () => {
  it('shows the group all shown, all hidden or mixed, and a click on a mixed one shows it all', async () => {
    const found = [...APP_FINDINGS, finding('java-exception', 300)];
    const { target } = await mountByGroup(found);
    expect(eyeState(groupRow(target, 'traceback'))).toEqual({
      pressed: 'true',
      icon: 'eye',
      label: 'Hide the findings of the group traceback',
    });

    await click(eyeOf(signatureRow(target, 'python-traceback')));
    expect(eyeState(groupRow(target, 'traceback'))).toEqual({
      pressed: 'mixed',
      icon: 'eye',
      label: 'Show the findings of the group traceback',
    });

    await click(eyeOf(groupRow(target, 'traceback')));
    expect(get(settings).findingsPicker).toBeNull();
    expect(eyeState(groupRow(target, 'traceback')).pressed).toBe('true');

    await click(eyeOf(groupRow(target, 'traceback')));
    expect(get(settings).findingsPicker).toEqual(['aws-access-key', 'sql-statement']);
    expect(eyeState(groupRow(target, 'traceback'))).toEqual({
      pressed: 'false',
      icon: 'eye-off',
      label: 'Show the findings of the group traceback',
    });
    expect(eyeState(signatureRow(target, 'java-exception')).pressed).toBe('false');
  });
});

describe('the actions of a header', () => {
  /** Whether `first` comes before `second` in the document. */
  const isBefore = (first: Node, second: Node) =>
    (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  /** What a header's right-hand end holds: its slots, its Copy and its eye. */
  function actionsOf(row: HTMLElement) {
    const actions = row.querySelector<HTMLElement>('[data-header-actions]');
    const copy = row.querySelector<HTMLButtonElement>('button[aria-label^="Copy the findings of"]');
    if (!actions || !copy) throw new Error('no actions or no Copy on the row');
    return { actions, copy, eye: eyeOf(row) };
  }

  function expectCopyThenEye(row: HTMLElement) {
    const { actions, copy, eye } = actionsOf(row);
    const [copySlot, eyeSlot, ...others] = [...actions.children];
    expect(row.lastElementChild).toBe(actions);
    expect(others).toHaveLength(0);
    expect(copySlot.contains(copy)).toBe(true);
    expect(eyeSlot.contains(eye)).toBe(true);
    expect(isBefore(copy, eye)).toBe(true);
    // One class for both slots: the Copy column and the eye column share a width.
    expect(copySlot.className).toBe(eyeSlot.className);
  }

  it('puts Copy before the eye, both in the right-hand slot of every group and signature header', async () => {
    const { target } = await mountByGroup();

    const headers = [
      groupRow(target, 'traceback'),
      signatureRow(target, 'python-traceback'),
      groupRow(target, 'sql'),
      signatureRow(target, 'sql-statement'),
    ];
    for (const row of headers) expectCopyThenEye(row);
  });

  it('keeps the layout of a hidden header, its Copy off and its eye shut', async () => {
    const { target } = await mountByGroup();

    await click(eyeOf(signatureRow(target, 'python-traceback')));

    for (const row of [groupRow(target, 'traceback'), signatureRow(target, 'python-traceback')]) {
      expectCopyThenEye(row);
      expect(actionsOf(row).copy.disabled).toBe(true);
      expect(eyeState(row).icon).toBe('eye-off');
    }
  });
});

describe('the eye of a group header, over the signatures the group view lists', () => {
  // java-exception and the opt-in phone-number hold no finding, so the
  // group view does not list them; the picker lists them.
  it('is shut while they are all hidden, with an unlisted member picked, and a click shows only them', async () => {
    const found = [...APP_FINDINGS, ...[5, 6, 7].map((line) => finding('email-address', line))];
    const current = [...TEST_DEFAULT_IDS, 'email-address', 'phone-number'];
    settings.update((s) => ({
      ...s,
      findingsPicker: ['aws-access-key', 'sql-statement', 'phone-number'],
    }));
    const { target } = await mountByGroup(found, current);

    expect(eyeState(groupRow(target, 'pii'))).toEqual({
      pressed: 'false',
      icon: 'eye-off',
      label: 'Show the findings of the group pii',
    });
    expect(eyeState(groupRow(target, 'traceback')).pressed).toBe('false');

    await click(eyeOf(groupRow(target, 'traceback')));

    expect(get(settings).findingsPicker).toEqual([
      'python-traceback',
      'aws-access-key',
      'sql-statement',
      'phone-number',
    ]);
    expect(eyeState(groupRow(target, 'traceback')).pressed).toBe('true');
  });
});

describe('a hidden signature', () => {
  it('is gone from the line view', async () => {
    const { target } = await mountByGroup();
    await click(eyeOf(signatureRow(target, 'python-traceback')));

    findingsBy.set('line');
    await settle();

    const text = rowsOf(target).map((row) => row.textContent ?? '');
    expect(text).toHaveLength(1);
    expect(text[0]).toContain('SQL statement');
  });

  it('stays in its place in the group view, greyed, with its count, and its Copy disabled', async () => {
    const { target } = await mountByGroup();

    await click(eyeOf(signatureRow(target, 'python-traceback')));

    const headers = rowsOf(target).map((row) => row.dataset.group ?? row.dataset.signature);
    expect(headers).toEqual(['traceback', 'python-traceback', 'sql', 'sql-statement']);
    const row = signatureRow(target, 'python-traceback');
    expect(row.hasAttribute('data-hidden')).toBe(true);
    expect(groupRow(target, 'traceback').hasAttribute('data-hidden')).toBe(true);
    expect(eyeState(groupRow(target, 'traceback'))).toMatchObject({
      pressed: 'false',
      icon: 'eye-off',
    });
    expect(signatureRow(target, 'sql-statement').hasAttribute('data-hidden')).toBe(false);
    expect(row.textContent).toContain('2');
    expect(buttonNamed(row, 'Copy the findings of Python traceback').disabled).toBe(true);
    expect(
      buttonNamed(groupRow(target, 'traceback'), 'Copy the findings of the group traceback')
        .disabled,
    ).toBe(true);
    expect(eyeOf(row).disabled).toBe(false);
    expect(
      buttonNamed(signatureRow(target, 'sql-statement'), 'Copy the findings of SQL statement')
        .disabled,
    ).toBe(false);
  });

  it("reads its pages over every signature, and a shown signature's with the picker's selection", async () => {
    const { backend, target } = await mountByGroup();
    await click(eyeOf(signatureRow(target, 'python-traceback')));
    const pageOf = (id: string) =>
      backend
        .requestsTo('GET', '/v1/findings')
        .map((request) => request.query)
        .filter((query) => query.has('offset') && query.getAll('signature').includes(id))
        .at(-1);

    await click(signatureRow(target, 'sql-statement'));
    await click(signatureRow(target, 'python-traceback'));

    expect(pageOf('sql-statement')?.get('signatures')).toBe(WITHOUT_TRACEBACK.join(','));
    expect(pageOf('python-traceback')?.get('signatures')).toBe('all');
  });

  it('says on its disabled Copy how to copy its findings', async () => {
    const { target } = await mountByGroup();

    await click(eyeOf(signatureRow(target, 'python-traceback')));

    const copyOf = (row: HTMLElement, label: string) => {
      const frame = buttonNamed(row, label).closest<HTMLElement>('[data-copy-off]');
      if (!frame) throw new Error(`no frame around ${label}`);
      return frame;
    };
    const signatureCopy = copyOf(
      signatureRow(target, 'python-traceback'),
      'Copy the findings of Python traceback',
    );
    const groupCopy = copyOf(
      groupRow(target, 'traceback'),
      'Copy the findings of the group traceback',
    );
    expect(hoverTooltipText(signatureCopy)).toBe(
      'Show the findings of Python traceback to copy them',
    );
    expect(hoverTooltipText(groupCopy)).toBe(
      'Show the findings of the group traceback to copy them',
    );
  });

  it('opens nothing from its expanded rows, on a click or on Enter', async () => {
    const { backend, target } = await mountByGroup();
    await click(eyeOf(signatureRow(target, 'python-traceback')));

    await click(signatureRow(target, 'python-traceback'));

    const pageQuery = backend.requestsTo('GET', '/v1/findings').at(-1)?.query;
    expect(pageQuery?.get('signatures')).toBe('all');
    expect(pageQuery?.getAll('signature')).toEqual(['python-traceback']);
    const findingRows = rowsOf(target).filter((row) => row.textContent?.includes('LINE 120'));
    expect(findingRows).toHaveLength(1);
    const [hiddenFinding] = findingRows;
    expect(hiddenFinding.hasAttribute('data-hidden')).toBe(true);

    await click(hiddenFinding);
    const enter = await keyDown(document.activeElement as HTMLElement, {
      key: 'Enter',
      code: 'Enter',
    });

    expect(enter.defaultPrevented).toBe(false);
    const [file] = get(files).openFiles;
    expect(file.selectedLines).toEqual([]);
    expect(file.anchorLine).not.toBe(120);
    const after = rowsOf(target).find((row) => row.textContent?.includes('LINE 120'));
    expect(after?.getAttribute('aria-selected')).toBe('false');
  });

  it('marks nothing in the editor, F8 passes over it, and the ticks leave it out', async () => {
    const { backend, target } = await mountByGroup();
    await click(eyeOf(signatureRow(target, 'python-traceback')));

    requestWindowFindings(APP_LOG, 1, 500, get(markInputs));
    await settle();
    stepFinding(APP_LOG, 100, 'next');
    await settle();
    const ticks = ticksRequestOf(APP_LOG, {
      width: 400,
      axis: { startMs: 1_000_000, endMs: 2_000_000 },
      zone: undefined,
      marks: get(markInputs),
    });

    const windowRequest = backend
      .requestsTo('GET', '/v1/findings')
      .find((request) => request.query.has('lines'));
    expect(windowRequest?.query.get('signatures')?.split(',')).toEqual(WITHOUT_TRACEBACK);
    const held = windowFindingsOf(get(windowFindings), APP_LOG);
    const decorations = findingDecorations(
      held,
      { startLine: 1, lineCount: 500 },
      get(signatures).groups,
      get(signatures).list,
    );
    expect(decorations.length).toBeGreaterThan(0);
    expect(new Set(decorations.map((d) => d.range.startLineNumber))).toEqual(new Set([200]));
    expect(get(files).openFiles[0].selectedLines).toEqual([{ start: 200, end: 200 }]);
    expect(ticks?.query.signatures).toEqual(WITHOUT_TRACEBACK);
  });
});

describe('the notice over the group view of hidden signatures', () => {
  it('speaks of the picked signatures, whose findings it says there are none of', async () => {
    settings.update((s) => ({ ...s, findingsPicker: ['java-exception'] }));
    const { target } = await mountByGroup();
    const notice = () =>
      target.querySelector('[data-findings-empty]')?.textContent?.replace(/\s+/g, ' ').trim();

    expect(notice()).toBe('No finding of the picked signatures.');
    expect(signatureRow(target, 'python-traceback').hasAttribute('data-hidden')).toBe(true);

    findingsFilter.set('timeout');
    await settle();

    expect(notice()).toBe('No finding of the picked signatures matches the filter.');
  });
});

describe('the hidden signatures the group view lists', () => {
  it('are those that hold findings in the cache, with the count of every signature read', async () => {
    const found = [...APP_FINDINGS, ...[5, 6, 7].map((line) => finding('email-address', line))];
    const current = ['python-traceback', 'sql-statement', 'email-address', 'phone-number'];
    settings.update((s) => ({ ...s, findingsPicker: ['python-traceback', 'sql-statement'] }));

    const { target } = await mountByGroup(found, current);

    const headers = rowsOf(target).map((row) => row.dataset.group ?? row.dataset.signature);
    expect(headers).toEqual([
      'traceback',
      'python-traceback',
      'sql',
      'sql-statement',
      'pii',
      'email-address',
    ]);
    const email = signatureRow(target, 'email-address');
    expect(email.hasAttribute('data-hidden')).toBe(true);
    expect(email.textContent).toContain('3');
    expect(eyeState(email).pressed).toBe('false');
  });

  // Hiding the last shown signature leaves the eyes that show them again.
  it('stay listed when nothing is picked, so that their eyes show them again', async () => {
    const found = [...APP_FINDINGS, finding('java-exception', 300), finding('aws-access-key', 310)];
    const { target } = await mountByGroup(found);

    for (const group of ['traceback', 'secret', 'sql']) {
      await click(eyeOf(groupRow(target, group)));
    }

    expect(get(settings).findingsPicker).toEqual([]);
    expect(target.querySelector('[data-findings-notice]')?.textContent).toContain(
      'No signatures are picked',
    );
    const headers = rowsOf(target).map((row) => row.dataset.group ?? row.dataset.signature);
    expect(headers).toEqual([
      'traceback',
      'python-traceback',
      'java-exception',
      'secret',
      'aws-access-key',
      'sql',
      'sql-statement',
    ]);

    await click(eyeOf(signatureRow(target, 'sql-statement')));

    expect(get(settings).findingsPicker).toEqual(['sql-statement']);
    expect(signatureRow(target, 'sql-statement').hasAttribute('data-hidden')).toBe(false);
  });
});

describe('Space on a header of the group view', () => {
  it('hides and shows the focused group or signature; Enter and the arrows keep their meaning', async () => {
    const { target } = await mountByGroup();
    const row = signatureRow(target, 'python-traceback');
    row.focus();

    const hide = await keyDown(row, { key: ' ', code: 'Space' });
    expect(hide.defaultPrevented).toBe(true);
    expect(get(settings).findingsPicker).toEqual(WITHOUT_TRACEBACK);
    expect(document.activeElement).toBe(signatureRow(target, 'python-traceback'));

    await keyDown(document.activeElement as HTMLElement, { key: ' ', code: 'Space' });
    expect(get(settings).findingsPicker).toBeNull();

    const before = signatureRow(target, 'python-traceback').getAttribute('aria-expanded');
    await keyDown(document.activeElement as HTMLElement, { key: 'Enter', code: 'Enter' });
    expect(signatureRow(target, 'python-traceback').getAttribute('aria-expanded')).not.toBe(before);
    const index = Number((document.activeElement as HTMLElement).dataset.index);
    await keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown', code: 'ArrowDown' });
    expect((document.activeElement as HTMLElement).dataset.index).toBe(String(index + 1));
  });

  it('leaves Space to an eye or a Copy that has the focus', async () => {
    const { target } = await mountByGroup();
    const row = signatureRow(target, 'python-traceback');
    const eye = eyeOf(row);
    eye.focus();

    const onEye = await keyDown(eye, { key: ' ', code: 'Space' });
    const copy = buttonNamed(row, 'Copy the findings of Python traceback');
    copy.focus();
    const onCopy = await keyDown(copy, { key: ' ', code: 'Space' });

    expect([onEye.defaultPrevented, onCopy.defaultPrevented]).toEqual([false, false]);
    expect(get(settings).findingsPicker).toBeNull();
  });
});
