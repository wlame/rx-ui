<!--
  The Findings panel: the findings of the file in the active tab, from
  the backend's findings cache. Its state line says how far the file is
  scanned; the picker chooses the signatures listed and scanned; the scan
  bar scans the missing ones; the toolbar lists them by line or by group
  and filters them; the list opens a finding in the editor.

  The panel stays mounted while another panel is shown, and asks the
  backend only while it is shown: when it shows a file, and again when
  the picker's choice or the filter changes. A scan belongs to its file
  (`stores/findings.ts`), so another tab shows its own state while the
  scan runs on.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { copyFindings, type FindingsCopyTarget } from '$lib/findingsCopy';
  import { backendHas, files, health, settings, tree } from '$lib/stores';
  import { activeOpenFile } from '$lib/stores/files';
  import {
    findingsByFile,
    findingsFilter,
    findingsOf,
    forgetFindings,
    refreshFindings,
    startScan,
    type ScanEnd,
  } from '$lib/stores/findings';
  import {
    findingsBy,
    findingsFocusRequested,
    sidebarTab,
    sidebarVisible,
  } from '$lib/stores/layout';
  import { loadSignatures, signatures } from '$lib/stores/signatures';
  import type { FindingRow } from '$lib/utils/findingRows';
  import { pickerSummary, selectionOf } from '$lib/utils/findingsPicker';
  import { stateLine } from '$lib/utils/findingsSummary';
  import { isChainKey } from '$lib/utils/tabKey';
  import Spinner from '../common/Spinner.svelte';
  import FindingsList from './FindingsList.svelte';
  import FindingsPicker from './FindingsPicker.svelte';
  import FindingsScanBar from './FindingsScanBar.svelte';
  import FindingsScanProgress from './FindingsScanProgress.svelte';
  import FindingsToolbar from './FindingsToolbar.svelte';

  /** Joins the paths of the open tabs into one string, which no path holds. */
  const PATH_SEPARATOR = '\u0000';

  const MUTED = 'text-gh-fg-muted dark:text-gh-fg-dark-muted';

  let panel: HTMLElement;

  // Strings, so the statements below run when the active tab or the open
  // tabs change, not at every update of the files store.
  $: activePath = activeOpenFile($files)?.path ?? null;
  $: openPaths = $files.openFiles.map((file) => file.path).join(PATH_SEPARATOR);
  $: forgetFindings(openPaths === '' ? [] : openPaths.split(PATH_SEPARATOR));

  $: hasFeature = backendHas('signatures', $health);
  $: isShown = $sidebarVisible && $sidebarTab === 'findings';
  $: isNotText = activePath !== null && isListedNotText($tree.roots, activePath);
  $: notice = noticeFor(hasFeature, activePath, isNotText, $signatures.loaded);
  $: filePath = notice === null ? activePath : null;
  $: tab = filePath === null ? null : findingsOf($findingsByFile, filePath);
  $: selection = selectionOf($settings.findingsPicker, $signatures);
  $: summaryText = pickerSummary($settings.findingsPicker, $signatures);
  $: if (isShown && hasFeature && !$signatures.loaded) void loadSignatures();

  // Ask for the summary when the panel shows a file, and again when the
  // choice or the filter changes.
  let askedKey: string | null = null;
  $: refreshKey =
    isShown && filePath !== null
      ? [filePath, JSON.stringify($settings.findingsPicker), $findingsFilter].join(PATH_SEPARATOR)
      : null;
  $: askOnce(refreshKey, filePath);

  /** Read the summary of `path` once for each `key`; a null key asks nothing. */
  function askOnce(key: string | null, path: string | null) {
    if (key === askedKey) return;
    askedKey = key;
    if (key !== null && path !== null) void refreshFindings(path);
  }

  /** Why the panel lists nothing for the active tab, or null when it lists its findings. */
  function noticeFor(
    hasSignatures: boolean,
    path: string | null,
    notText: boolean,
    isCatalogueLoaded: boolean,
  ): string | null {
    if (!hasSignatures) return 'This backend does not scan files for findings.';
    if (path === null) return 'Open a file to list its findings.';
    if (isChainKey(path)) return 'Findings are per file. Open a part of the chain to scan it.';
    if (notText) return `${nameOf(path)} is not text, so it has no findings.`;
    if (!isCatalogueLoaded) return 'Loading the signatures…';
    return null;
  }

  /**
   * Whether the tree lists `path` as not text. `roots` is the tree the
   * answer comes from, so the statement that asks runs again when it changes.
   */
  function isListedNotText(_roots: unknown, path: string): boolean {
    return tree.nodeAt(path)?.is_text === false;
  }

  function nameOf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
  }

  /** What the panel says of a scan that ended for each reason but a failure, which has its own. */
  const SCAN_END_NOTICES: Readonly<Record<Exclude<ScanEnd['kind'], 'failed'>, string>> = {
    cancelled: 'Scan cancelled.',
    notKept:
      'The file changed while it was scanned, so its findings were not kept. ' +
      'Scan again when it is quiet.',
  };

  function scanEndText(end: ScanEnd): string {
    return end.kind === 'failed' ? `Scan failed: ${end.message}` : SCAN_END_NOTICES[end.kind];
  }

  /**
   * What Copy on a header takes: its group or its signature. A group the
   * catalogue does not name has no name the backend filters by, and no Copy.
   */
  function copyTargetOf(row: FindingRow): FindingsCopyTarget | null {
    if (row.kind === 'signature') return { kind: 'signature', id: row.id };
    if (row.kind === 'group' && row.group !== '') return { kind: 'group', group: row.group };
    return null;
  }

  /** The label of a header's Copy: what it copies. */
  function copyLabelOf(target: FindingsCopyTarget): string {
    if (target.kind === 'group') return `Copy the findings of the group ${target.group}`;
    if (target.kind === 'signature') {
      const name = $signatures.list.find((s) => s.id === target.id)?.name ?? target.id;
      return `Copy the findings of ${name}`;
    }
    return 'Copy all';
  }

  function copy(target: FindingsCopyTarget) {
    if (filePath !== null) void copyFindings(filePath, target);
  }

  // Copy all copies what the panel lists: nothing while nothing is picked.
  $: canCopyAll = selection !== null && (tab?.summary?.total ?? 0) > 0;

  /** The large Scan button of a file the picked signatures have not scanned. */
  function scanFirst() {
    if (filePath !== null && tab?.summary) void startScan(filePath, tab.summary.missing, false);
  }

  // Alt+3 asks for the focus; it waits until the panel has its content.
  $: hasContent = notice !== null || tab?.summary != null || tab?.error != null;
  $: if ($findingsFocusRequested && panel && hasContent) void takeFocus();

  /** Focus the list's current row, else the panel's first control, else the panel. */
  async function takeFocus() {
    findingsFocusRequested.set(false);
    await tick();
    const row = panel.querySelector<HTMLElement>('[data-findings-scroller] [tabindex="0"]');
    const control = panel.querySelector<HTMLElement>('button:enabled, input, select');
    (row ?? control ?? panel).focus();
  }
</script>

<section
  bind:this={panel}
  class="h-full flex flex-col focus:outline-none"
  aria-label="Findings"
  tabindex="-1"
  data-findings-panel
>
  <div class="px-3 py-2 border-b border-gh-border-default dark:border-gh-border-dark-default">
    <h2 class="text-xs font-semibold uppercase tracking-wide {MUTED}">Findings</h2>
  </div>

  {#if notice !== null}
    <p class="px-3 py-4 text-sm {MUTED}" data-findings-notice>{notice}</p>
  {:else if filePath !== null && tab !== null}
    <p class="px-3 pt-2 text-xs truncate" title={filePath}>
      <span class="font-medium">{nameOf(filePath)}</span>
      {#if tab.fileSummary}
        · <span data-findings-state>{stateLine(tab.fileSummary)}</span>
      {/if}
    </p>
    <div class="relative flex items-center gap-1.5 px-3 pt-1.5" data-findings-controls>
      <FindingsPicker path={filePath} />
      <span class="flex-1" />
      <FindingsScanBar
        path={filePath}
        {tab}
        {selection}
        onCopyAll={canCopyAll ? () => copy({ kind: 'all' }) : null}
      />
    </div>
    {#if tab.scan}
      <FindingsScanProgress path={filePath} scan={tab.scan} />
    {/if}
    {#if tab.scanEnd && !tab.scan}
      <p class="px-3 pt-1 text-xs {MUTED}" role="status" data-scan-end>
        {scanEndText(tab.scanEnd)}
      </p>
    {/if}
    <FindingsToolbar />

    {#if tab.error}
      <p
        class="px-3 py-4 text-sm text-gh-danger-fg dark:text-gh-danger-dark-fg"
        data-findings-error
      >
        {tab.error}
      </p>
    {:else if !tab.summary}
      <div class="flex justify-center py-6"><Spinner size="md" /></div>
    {:else if selection === null}
      <p class="px-3 py-4 text-sm {MUTED}" data-findings-notice>
        No signatures are picked. Pick some to list and scan their findings.
      </p>
    {:else if tab.summary.checked.length === 0}
      <div class="flex flex-col items-center gap-3 px-3 py-6 text-sm {MUTED}">
        <p>The picked signatures have not scanned this file yet.</p>
        <!-- While a scan runs, the progress row under the picker shows it. -->
        {#if tab.scan === null}
          <button
            type="button"
            class="btn btn-primary"
            disabled={tab.summary.missing.length === 0}
            on:click={scanFirst}
          >
            Scan with {summaryText}
          </button>
        {/if}
      </div>
    {:else if tab.summary.total === 0}
      <p class="px-3 py-4 text-sm {MUTED}">
        {$findingsFilter === '' ? 'No findings.' : 'No finding matches the filter.'}
      </p>
    {:else}
      <FindingsList path={filePath} {tab} view={$findingsBy} catalogue={$signatures}>
        <!-- A Copy is not a Tab stop, so the list stays one, and a press on
             it leaves the focus where it was, so the list's keys stay the
             list's. Its click stays with it: the header neither opens nor
             closes. -->
        <svelte:fragment slot="header-actions" let:row>
          {@const target = copyTargetOf(row)}
          {#if target}
            <button
              type="button"
              tabindex="-1"
              class="px-1.5 rounded text-xs {MUTED}
                     hover:bg-gh-canvas-inset dark:hover:bg-gh-canvas-dark-inset
                     hover:text-gh-fg-default dark:hover:text-gh-fg-dark-default"
              aria-label={copyLabelOf(target)}
              title={copyLabelOf(target)}
              on:mousedown|preventDefault
              on:click|stopPropagation={() => copy(target)}
            >
              Copy
            </button>
          {/if}
        </svelte:fragment>
      </FindingsList>
    {/if}
  {/if}
</section>
