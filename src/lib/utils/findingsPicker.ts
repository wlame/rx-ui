/**
 * The rules of the findings panel's signature picker, as data and pure
 * functions: which signatures a stored choice picks, how a choice is
 * stored, what selection a request sends, the three-state group boxes,
 * the presets and the filter.
 *
 * The choice is a viewer's own preference (`AppSettings.findingsPicker`):
 * null is the default set, so it follows the catalogue the backend
 * loaded; anything else is a list of ids, read against the live
 * catalogue, since a user's signature files may have changed since.
 */
import { defaultSetIds, type SignaturesState } from '../stores/signatures';
import type { GroupInfo, SignatureInfo } from '../types';

type Catalogue = Pick<SignaturesState, 'list'>;

/** Every signature no user file disabled, opt-in ones included, in catalogue order. */
export function activeSignatures(list: readonly SignatureInfo[]): SignatureInfo[] {
  return list.filter((signature) => !signature.disabled_by);
}

/** The ids of every active signature, in catalogue order. */
export function activeIds(catalogue: Catalogue): string[] {
  return activeSignatures(catalogue.list).map((signature) => signature.id);
}

/** The ids of `catalogue` that `ids` holds, in catalogue order, each once. */
function inCatalogueOrder(ids: Iterable<string>, catalogue: Catalogue): string[] {
  const wanted = new Set(ids);
  return activeIds(catalogue).filter((id) => wanted.has(id));
}

/** Whether two lists hold the same ids, in any order. */
function isSameSet(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((id) => set.has(id));
}

/**
 * The signatures a stored choice picks: the default set for none, else
 * the stored ids the catalogue holds and has not disabled (a backend
 * refuses a selection that names any other), in catalogue order.
 */
export function pickedIds(stored: readonly string[] | null, catalogue: Catalogue): string[] {
  if (stored === null) return defaultSetIds(catalogue);
  return inCatalogueOrder(stored, catalogue);
}

/**
 * How a choice of `ids` is stored: null when it is the default set, so
 * it keeps following the catalogue, else the ids in catalogue order.
 */
export function pickerChoice(ids: readonly string[], catalogue: Catalogue): string[] | null {
  const ordered = inCatalogueOrder(ids, catalogue);
  return isSameSet(ordered, pickedIds(null, catalogue)) ? null : ordered;
}

/**
 * The selection a findings request sends for a stored choice
 * (`FindingsQuery.signatures`): none for the default set, `all` for
 * every active signature, else the picked ids. Null when nothing is
 * picked: an empty selection would be the default set.
 */
export function selectionOf(
  stored: readonly string[] | null,
  catalogue: Catalogue,
): string[] | null {
  if (stored === null) return [];
  const ids = pickedIds(stored, catalogue);
  if (ids.length === 0) return null;
  return isSameSet(ids, activeIds(catalogue)) ? ['all'] : ids;
}

/** How much of a group the choice picks. */
export type CheckState = 'all' | 'some' | 'none';

/** How many of a group's shown `ids` are picked; none for a group that shows none. */
export function groupCheckState(ids: readonly string[], picked: ReadonlySet<string>): CheckState {
  const count = ids.filter((id) => picked.has(id)).length;
  if (count === 0) return 'none';
  return count === ids.length ? 'all' : 'some';
}

/** A group's box clicked: every shown id picked when not all were, else every one dropped. */
export function toggleGroup(ids: readonly string[], picked: readonly string[]): string[] {
  const isWhole = groupCheckState(ids, new Set(picked)) === 'all';
  if (isWhole) return picked.filter((id) => !ids.includes(id));
  return [...new Set([...picked, ...ids])];
}

/** A signature's box clicked: picked when it was not, dropped when it was. */
export function toggleSignature(id: string, picked: readonly string[]): string[] {
  return picked.includes(id) ? picked.filter((other) => other !== id) : [...picked, id];
}

/** A preset of the picker: its button's label and the choice it stores. */
export interface PickerPreset {
  label: 'Default' | 'All' | 'None';
  choose(catalogue: Catalogue): string[] | null;
}

export const PICKER_PRESETS: readonly PickerPreset[] = [
  { label: 'Default', choose: () => null },
  { label: 'All', choose: (catalogue) => activeIds(catalogue) },
  { label: 'None', choose: () => [] },
];

/**
 * The picker button's summary of a stored choice: the preset it equals
 * with its count (`Default (64)`, `All (70)`, `None`), or how many
 * signatures it picks.
 */
export function pickerSummary(stored: readonly string[] | null, catalogue: Catalogue): string {
  const ids = pickedIds(stored, catalogue);
  if (stored === null) return `Default (${ids.length})`;
  if (ids.length === 0) return 'None';
  if (isSameSet(ids, activeIds(catalogue))) return `All (${ids.length})`;
  return ids.length === 1 ? '1 signature' : `${ids.length} signatures`;
}

/**
 * The signatures whose id, name, group or one of whose tags holds
 * `text`, compared without case; every signature for a blank text.
 */
export function filterSignatures(list: readonly SignatureInfo[], text: string): SignatureInfo[] {
  const needle = text.trim().toLowerCase();
  if (needle === '') return [...list];
  return list.filter((signature) =>
    [signature.id, signature.name, signature.group, ...signature.tags].some((word) =>
      word.toLowerCase().includes(needle),
    ),
  );
}

/** One group of the picker's checklist: its name and its active signatures shown. */
export interface PickerGroup {
  name: string;
  signatures: SignatureInfo[];
}

/**
 * The checklist of the picker: the active signatures of `list` group by
 * group, in the catalogue's group order (a group the list names and the
 * groups do not, last), each in catalogue order; a group with none shown
 * is left out.
 */
export function pickerGroups(
  list: readonly SignatureInfo[],
  groups: readonly GroupInfo[],
): PickerGroup[] {
  const order = new Map(groups.map((group) => [group.name, group.order]));
  const byGroup = new Map<string, SignatureInfo[]>();
  for (const signature of activeSignatures(list)) {
    const members = byGroup.get(signature.group) ?? [];
    members.push(signature);
    byGroup.set(signature.group, members);
  }
  const rank = (name: string) => order.get(name) ?? Number.MAX_SAFE_INTEGER;
  return [...byGroup]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([name, signatures]) => ({ name, signatures }));
}
