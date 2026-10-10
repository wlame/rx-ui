<!--
  The findings of the open file as a virtual list: rows of one height,
  only those on screen (and a few around them) drawn, the list as long as
  all of them. By line, every row is a finding of the filtered list, in
  line order; by group, the group and signature headers come first, each
  over its findings, and a signature's findings load when it is opened.
  Rows not loaded yet load by page as they come on screen, each page once.

  The list is one Tab stop (a roving tabindex): the current row has
  `tabindex="0"` and is always drawn. One key handler works out each key
  from the rows (`utils/findingsNav.ts`); while a dialog is open, every
  key is the dialog's. A click or Enter on a finding opens it: its lines
  are selected and the editor goes to them.
-->
<script context="module" lang="ts">
  /** The height of every row, in pixels: a virtual list needs one height for all. */
  export const ROW_HEIGHT_PX = 24;
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { measureHeight } from '$lib/actions/measureHeight';
  import {
    FINDINGS_PAGE_SIZE,
    LINE_LIST,
    loadFindingsPage,
    openFinding,
    type FindingsTabState,
  } from '$lib/stores/findings';
  import { modalOpen } from '$lib/stores/layout';
  import type { SignaturesState } from '$lib/stores/signatures';
  import type { FindingsResponse } from '$lib/types';
  import {
    findingId,
    groupKey,
    groupRows,
    lineRowAt,
    signatureKey,
    type FindingRow,
  } from '$lib/utils/findingRows';
  import {
    findingsKeyAction,
    rowLevel,
    type FindingRows,
    type FindingsNavAction,
    type FindingsView,
  } from '$lib/utils/findingsNav';
  import { belongsToInputMethod } from '$lib/utils/keyTargets';
  import { memoizeLast } from '$lib/utils/memoizeLast';
  import { isShortcut, type ShortcutId } from '$lib/utils/shortcuts';
  import { pagesInWindow, visibleWindow } from '$lib/utils/virtualList';
  import FindingRowContent from './FindingRowContent.svelte';

  /** The open file. */
  export let path: string;
  export let tab: FindingsTabState;
  export let view: FindingsView;
  export let catalogue: SignaturesState;

  /** Rows drawn beyond each end of the screen. */
  const OVERSCAN = 8;
  /** The height the list is taken to have before the browser has laid it out. */
  const FALLBACK_VIEWPORT_PX = 480;
  /** Each level of the group view indents its rows by this much. */
  const LEVEL_INDENT_PX = 12;
  const ROW_PADDING_PX = 8;
  const ROW_CLASS =
    'absolute inset-x-0 flex items-center gap-2 pr-2 text-xs cursor-pointer select-none ' +
    'whitespace-nowrap hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset ' +
    'focus-visible:ring-gh-accent-emphasis dark:focus-visible:ring-gh-accent-dark-emphasis';
  const CURRENT_CLASS = 'bg-gh-accent-emphasis/10 dark:bg-gh-accent-dark-emphasis/20';
  /** The keys of the shortcut table that the key rules work out. */
  const NAVIGATION_KEYS: readonly ShortcutId[] = [
    'findingsMove',
    'findingsEnds',
    'findingsExpand',
    'findingsCollapse',
    'findingsOpen',
  ];

  let scroller: HTMLElement;
  let scrollTop = 0;
  let viewport = 0;
  /** The row that holds the Tab stop, by index; null before a row was focused. */
  let focusIndex: number | null = null;
  /** The groups closed, and the signatures opened, in the group view. */
  let closedGroups = new Set<string>();
  let openSignatures = new Set<string>();

  const groupRowsOf = memoizeLast(groupRows);
  const signaturesById = memoizeLast(
    (list: SignaturesState['list']) => new Map(list.map((signature) => [signature.id, signature])),
  );
  const collapsedOf = memoizeLast(
    (summary: FindingsResponse, closed: Set<string>, opened: Set<string>) =>
      new Set([
        ...[...closed].map(groupKey),
        ...summary.checked.filter((id) => !opened.has(id)).map(signatureKey),
      ]),
  );

  $: summary = tab.summary;
  $: rows = rowsOf(view, summary, tab.pages, closedGroups, openSignatures);
  $: shown = visibleWindow(
    rows.count,
    ROW_HEIGHT_PX,
    scrollTop,
    viewport || FALLBACK_VIEWPORT_PX,
    OVERSCAN,
  );
  $: tabStop = rows.count === 0 ? null : Math.min(focusIndex ?? 0, rows.count - 1);
  $: drawn = drawnIndices(shown.first, shown.last, tabStop);
  $: loadShownPages(rows, shown.first, shown.last);
  $: signatureOf = signaturesById(catalogue.list);
  $: resetFor(path, view);

  /** The rows of the view: a finding per place by line; headers over their findings by group. */
  function rowsOf(
    by: FindingsView,
    answer: FindingsResponse | null,
    pages: FindingsTabState['pages'],
    closed: Set<string>,
    opened: Set<string>,
  ): FindingRows {
    if (answer === null) return { count: 0, rowAt: (index) => lineRowAt(undefined, index) };
    if (by === 'line') {
      const list = pages.get(LINE_LIST);
      return { count: answer.total, rowAt: (index) => lineRowAt(list, index) };
    }
    const list = groupRowsOf(answer, pages, collapsedOf(answer, closed, opened), catalogue);
    return { count: list.length, rowAt: (index) => list[index] };
  }

  /** A new file or order starts at the top, with no row focused. */
  function resetFor(_path: string, _view: FindingsView) {
    focusIndex = null;
    scrollTop = 0;
    if (scroller) scroller.scrollTop = 0;
  }

  /** The rows to draw: those on screen and around them, and the Tab stop wherever it is. */
  function drawnIndices(first: number, last: number, stop: number | null): number[] {
    const indices = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
    if (stop !== null && (stop < first || stop > last)) indices.push(stop);
    return indices.sort((a, b) => a - b);
  }

  /** Ask for the pages of the rows on screen not loaded yet; the store asks each page once. */
  function loadShownPages(list: FindingRows, first: number, last: number) {
    if (view === 'line') {
      for (const page of pagesInWindow(first, last, FINDINGS_PAGE_SIZE)) {
        void loadFindingsPage(path, LINE_LIST, page);
      }
      return;
    }
    for (let index = first; index <= last; index++) {
      const row = list.rowAt(index);
      if (row.kind === 'placeholder' && row.signature !== null) {
        void loadFindingsPage(path, row.signature, Math.floor(row.index / FINDINGS_PAGE_SIZE));
      }
    }
  }

  function handleScroll() {
    scrollTop = scroller.scrollTop;
  }

  /** The list's height, as laid out: when it is drawn and whenever it changes. */
  function noteHeight(px: number) {
    viewport = px;
  }

  /** Scroll just enough to show the row at `index`. */
  function scrollToRow(index: number) {
    const height = viewport || FALLBACK_VIEWPORT_PX;
    const top = index * ROW_HEIGHT_PX;
    let next = scrollTop;
    if (top < scrollTop) next = top;
    else if (top + ROW_HEIGHT_PX > scrollTop + height) next = top + ROW_HEIGHT_PX - height;
    scroller.scrollTop = next;
    scrollTop = next;
  }

  /** Make the row at `index` current, show it and give it the focus. */
  async function focusRow(index: number) {
    focusIndex = index;
    scrollToRow(index);
    await tick();
    scroller.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus();
  }

  /** Open or close a header row. */
  function setHeaderOpen(row: FindingRow, isOpen: boolean) {
    if (row.kind === 'group') {
      closedGroups = toggled(closedGroups, row.group, !isOpen);
    } else if (row.kind === 'signature') {
      openSignatures = toggled(openSignatures, row.id, isOpen);
    }
  }

  function toggled(set: Set<string>, member: string, isIn: boolean): Set<string> {
    const next = new Set(set);
    if (isIn) next.add(member);
    else next.delete(member);
    return next;
  }

  /** What a key's action does to the list. */
  function apply(action: FindingsNavAction, index: number) {
    const row = rows.rowAt(index);
    if (action.type === 'focus') void focusRow(action.index);
    else if (action.type === 'open' && row.kind === 'finding') openFinding(path, row.finding);
    else if (action.type === 'expand' || action.type === 'collapse') {
      setHeaderOpen(row, action.type === 'expand');
    }
  }

  /** The index of the row `target` is or is inside of; null outside the rows. */
  function rowIndexOf(target: EventTarget | null): number | null {
    if (!(target instanceof Element)) return null;
    const index = target.closest<HTMLElement>('[data-index]')?.dataset.index;
    return index === undefined ? null : Number(index);
  }

  /**
   * The list's one key handler. A key with Ctrl, Cmd or Alt belongs to
   * the shortcut table, and a key an input method composes with to it.
   * The key is cancelled only when it acted.
   */
  function handleKeydown(event: KeyboardEvent) {
    if ($modalOpen) return;
    if (event.ctrlKey || event.metaKey || event.altKey || belongsToInputMethod(event)) return;
    const index = rowIndexOf(event.target);
    if (index === null || !NAVIGATION_KEYS.some((id) => isShortcut(id, event))) return;
    const action = findingsKeyAction(rows, index, event.key, view);
    if (action.type === 'none') return;
    event.preventDefault();
    apply(action, index);
  }

  /** A click opens a finding, or opens or closes a header, and makes the row current. */
  function handleClick(index: number) {
    if ($modalOpen) return;
    const row = rows.rowAt(index);
    if (row.kind === 'finding') openFinding(path, row.finding);
    else if (row.kind !== 'placeholder') setHeaderOpen(row, row.collapsed);
    void focusRow(index);
  }

  function handleFocusin(event: FocusEvent) {
    const index = rowIndexOf(event.target);
    if (index !== null) focusIndex = index;
  }

  function isCurrent(row: FindingRow): boolean {
    return row.kind === 'finding' && findingId(row.finding) === tab.currentId;
  }

  function isHeader(row: FindingRow): row is Extract<FindingRow, { kind: 'group' | 'signature' }> {
    return row.kind === 'group' || row.kind === 'signature';
  }
</script>

<div
  bind:this={scroller}
  class="flex-1 overflow-auto"
  data-findings-scroller
  use:measureHeight={noteHeight}
  on:scroll={handleScroll}
>
  <!-- The rows hold the focus, one of them the Tab stop; the list takes
       none, and its key handler answers the keys of its rows. A click on
       a row does what Enter does there. -->
  {#if view === 'group'}
    <!-- svelte-ignore a11y-interactive-supports-focus -->
    <div
      role="tree"
      aria-label="Findings by group"
      class="relative"
      style="height: {rows.count * ROW_HEIGHT_PX}px"
      on:keydown={handleKeydown}
      on:focusin={handleFocusin}
    >
      {#each drawn as index (index)}
        {@const row = rows.rowAt(index)}
        {@const level = rowLevel(row)}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div
          role="treeitem"
          tabindex={index === tabStop ? 0 : -1}
          data-index={index}
          data-group={row.kind === 'group' ? row.group : undefined}
          data-signature={row.kind === 'signature' ? row.id : undefined}
          aria-selected={isCurrent(row)}
          aria-level={level}
          aria-expanded={isHeader(row) ? !row.collapsed : undefined}
          class="{ROW_CLASS} {isCurrent(row) ? CURRENT_CLASS : ''}"
          style="top: {index * ROW_HEIGHT_PX}px; height: {ROW_HEIGHT_PX}px; padding-left: {(level -
            1) *
            LEVEL_INDENT_PX +
            ROW_PADDING_PX}px"
          on:click={() => handleClick(index)}
        >
          <FindingRowContent {row} {signatureOf} {catalogue} />
          {#if isHeader(row)}
            <span class="ml-auto flex-shrink-0"><slot name="header-actions" {row} /></span>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <!-- svelte-ignore a11y-interactive-supports-focus -->
    <div
      role="listbox"
      aria-label="Findings by line"
      class="relative"
      style="height: {rows.count * ROW_HEIGHT_PX}px"
      on:keydown={handleKeydown}
      on:focusin={handleFocusin}
    >
      {#each drawn as index (index)}
        {@const row = rows.rowAt(index)}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div
          role="option"
          tabindex={index === tabStop ? 0 : -1}
          data-index={index}
          aria-selected={isCurrent(row)}
          aria-setsize={rows.count}
          aria-posinset={index + 1}
          class="{ROW_CLASS} {isCurrent(row) ? CURRENT_CLASS : ''}"
          style="top: {index *
            ROW_HEIGHT_PX}px; height: {ROW_HEIGHT_PX}px; padding-left: {ROW_PADDING_PX}px"
          on:click={() => handleClick(index)}
        >
          <FindingRowContent {row} {signatureOf} {catalogue} />
        </div>
      {/each}
    </div>
  {/if}
</div>
