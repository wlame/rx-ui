import { get } from 'svelte/store';
import { openTreeRow } from './fileOpening';
import { startScan } from './stores/findings';
import { showPanel } from './stores/layout';
import { settings } from './stores/settings';
import { loadSignatures, signatures } from './stores/signatures';
import { pickedIds } from './utils/findingsPicker';

/**
 * The files panel's "Scan for findings" on a text file: open the file,
 * show the Findings panel, and scan the file with the signatures the
 * panel's picker chooses, of which the backend scans only those its cache
 * does not answer. The scan is the panel's own (`startScan`): the panel
 * shows its progress and Cancel, and its end labels the file in the tree.
 * With nothing picked nothing is scanned, and the panel says why.
 */
export async function scanForFindings(path: string): Promise<void> {
  openTreeRow(path);
  showPanel('findings', false);
  await loadSignatures();
  const ids = pickedIds(get(settings).findingsPicker, get(signatures));
  if (ids.length > 0) await startScan(path, ids, false);
}
