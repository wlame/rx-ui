/**
 * The rows the findings panel lists, as one flat list a virtual list
 * draws: in the line view each row is a finding of the filtered list, in
 * the group view the group and signature headers come first, each over
 * its findings.
 *
 * A row whose finding has not arrived yet is a placeholder: the panel
 * loads findings by page (`GET /v1/findings` with `offset` and `limit`),
 * and a list knows its length before it holds its findings. A loaded
 * list is a sparse array as long as the list, with each loaded finding
 * at its place.
 *
 * The group view also lists the signatures the picker's choice hides
 * (`AppSettings.findingsPicker`), in their places, greyed: each header
 * has an eye that hides or shows its findings by checking or unchecking
 * the same boxes as the picker, so the two are one state.
 */
import type { SignaturesState } from '../stores/signatures';
import type { Finding, FindingsResponse } from '../types';
import {
  activeIds,
  groupCheckState,
  pickedIds,
  pickerChoice,
  toggleGroup,
  toggleSignature,
  type CheckState,
} from './findingsPicker';

/**
 * A row of the findings list. On a header, `eye` is what its eye shows:
 * how much of what the header lists the choice shows (a group's `ids`,
 * the signatures listed under it that a choice can pick, or the
 * signature), or null for a header with no eye (one the catalogue does
 * not name, which no choice can hide); `hidden` says every finding
 * under it is hidden, so it is greyed and its Copy is off. A hidden
 * finding is greyed and opens nothing.
 */
export type FindingRow =
  | {
      kind: 'group';
      group: string;
      count: number;
      collapsed: boolean;
      eye: CheckState | null;
      hidden: boolean;
      ids: readonly string[];
    }
  | {
      kind: 'signature';
      id: string;
      count: number;
      stored: number;
      collapsed: boolean;
      eye: CheckState | null;
      hidden: boolean;
    }
  | { kind: 'finding'; finding: Finding; index: number; hidden: boolean }
  | { kind: 'placeholder'; signature: string | null; index: number };

/** A header row: a group's or a signature's. */
export type HeaderRow = Extract<FindingRow, { kind: 'group' | 'signature' }>;

/** The findings count of every signature with a current entry for a file, by id. */
export type SignatureCounts = FindingsResponse['counts'];

type Catalogue = Pick<SignaturesState, 'list' | 'groups'>;

/** The key of a group's header in the set of collapsed headers. */
export function groupKey(group: string): string {
  return `group:${group}`;
}

/** The key of a signature's header in the set of collapsed headers. */
export function signatureKey(id: string): string {
  return `signature:${id}`;
}

/**
 * A finding's identity in a file: its signature and the offset it starts
 * at. Two findings of one signature never start at the same place.
 */
export function findingId(finding: Pick<Finding, 'signature' | 'start_offset'>): string {
  return `${finding.signature}:${finding.start_offset}`;
}

/** The row at `index` of the line view, whose loaded findings are `list`. */
export function lineRowAt(list: readonly Finding[] | undefined, index: number): FindingRow {
  const found = list?.[index];
  return found
    ? { kind: 'finding', finding: found, index, hidden: false }
    : { kind: 'placeholder', signature: null, index };
}

/**
 * Add the rows of one expanded signature to `rows`: its loaded findings,
 * a placeholder for each other. One push per row: a signature may store a
 * million findings, too many to pass as the arguments of one call.
 */
function addFindingRows(
  rows: FindingRow[],
  id: string,
  list: readonly Finding[] | undefined,
  hidden: boolean,
) {
  // Before its first page arrives the length of a filtered list is not
  // known: one placeholder stands for it.
  if (list === undefined) {
    rows.push({ kind: 'placeholder', signature: id, index: 0 });
    return;
  }
  for (let index = 0; index < list.length; index++) {
    const found = list[index];
    rows.push(
      found
        ? { kind: 'finding', finding: found, index, hidden }
        : { kind: 'placeholder', signature: id, index },
    );
  }
}

/** The place of a name in an order; a name the order lacks comes after every listed one. */
function rankIn(order: ReadonlyMap<string, number>, name: string): number {
  return order.get(name) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * `ids` by group: the groups in catalogue order, then a group the
 * catalogue's groups list lacks, then '' for the ids the catalogue does
 * not name; each group's ids in catalogue order.
 */
function idsByGroup(
  ids: readonly string[],
  catalogue: Catalogue,
): [group: string, ids: string[]][] {
  const position = new Map(catalogue.list.map((signature, index) => [signature.id, index]));
  const groupOf = new Map(catalogue.list.map((signature) => [signature.id, signature.group]));
  const groupOrder = new Map(catalogue.groups.map((group) => [group.name, group.order]));
  const byGroup = new Map<string, string[]>();
  for (const id of ids) {
    const group = groupOf.get(id) ?? '';
    const members = byGroup.get(group) ?? [];
    members.push(id);
    byGroup.set(group, members);
  }
  const groupRank = (group: string) => (group === '' ? Infinity : rankIn(groupOrder, group));
  return [...byGroup]
    .sort(([a], [b]) => groupRank(a) - groupRank(b))
    .map(([group, members]) => [
      group,
      members.sort((a, b) => rankIn(position, a) - rankIn(position, b)),
    ]);
}

/**
 * The signatures the group view shows: those the choice picks (`picked`,
 * from `pickedIds`) and, while it picks any, those the summary lists
 * (`checked`) that the catalogue does not name, which no choice can hide.
 */
export function shownSignatures(
  picked: readonly string[],
  checked: readonly string[],
  catalogue: Pick<SignaturesState, 'list'>,
): Set<string> {
  if (picked.length === 0) return new Set();
  const named = new Set(catalogue.list.map((signature) => signature.id));
  return new Set([...picked, ...checked.filter((id) => !named.has(id))]);
}

/**
 * The signatures the group view lists: those with findings that are
 * shown, or that the choice could show (the active signatures it hides).
 */
function listedIds(
  counts: SignatureCounts,
  shown: ReadonlySet<string>,
  catalogue: Pick<SignaturesState, 'list'>,
): string[] {
  const pickable = new Set(activeIds(catalogue));
  return Object.keys(counts).filter(
    (id) => (counts[id]?.count ?? 0) > 0 && (shown.has(id) || pickable.has(id)),
  );
}

/** Whether the group view lists a hidden signature: one the choice could show holds findings. */
export function holdsHiddenFindings(
  counts: SignatureCounts,
  shown: ReadonlySet<string>,
  catalogue: Pick<SignaturesState, 'list'>,
): boolean {
  return listedIds(counts, shown, catalogue).some((id) => !shown.has(id));
}

/**
 * The rows of the group view: each group in catalogue order with the
 * sum of its signatures' counts, then, unless the group is collapsed,
 * each of its signatures with findings, in catalogue order, with its
 * count and how many of them are stored, then, unless the signature is
 * collapsed, its findings as loaded in `pages` (by signature id).
 *
 * `counts` holds what the file holds of every current signature, picked
 * or not; `shown` the signatures shown (`shownSignatures`). A signature
 * the choice hides is listed in its place, hidden, when it holds
 * findings. A group's eye speaks of the signatures listed under it,
 * not of its other members, as the rows under it do. `collapsed` holds the keys of the collapsed headers
 * (`groupKey`, `signatureKey`). A signature without findings, and a
 * group left without a signature, has no row. A signature the catalogue
 * does not name comes last, under a group with no name.
 */
export function groupRows(
  counts: SignatureCounts,
  shown: ReadonlySet<string>,
  pages: ReadonlyMap<string, readonly Finding[]>,
  collapsed: ReadonlySet<string>,
  catalogue: Catalogue,
): FindingRow[] {
  const rows: FindingRow[] = [];
  const pickable = new Set(activeIds(catalogue));
  const listed = listedIds(counts, shown, catalogue);
  for (const [group, ids] of idsByGroup(listed, catalogue)) {
    const eyeIds = ids.filter((id) => pickable.has(id));
    const isGroupCollapsed = collapsed.has(groupKey(group));
    rows.push({
      kind: 'group',
      group,
      count: ids.reduce((sum, id) => sum + counts[id].count, 0),
      collapsed: isGroupCollapsed,
      eye: eyeIds.length > 0 ? groupCheckState(eyeIds, shown) : null,
      hidden: ids.every((id) => !shown.has(id)),
      ids: eyeIds,
    });
    if (isGroupCollapsed) continue;
    for (const id of ids) {
      const { count, stored } = counts[id];
      const isCollapsed = collapsed.has(signatureKey(id));
      const hidden = !shown.has(id);
      const eye = pickable.has(id) ? (hidden ? 'none' : 'all') : null;
      rows.push({ kind: 'signature', id, count, stored, collapsed: isCollapsed, eye, hidden });
      if (!isCollapsed) addFindingRows(rows, id, pages.get(id), hidden);
    }
  }
  return rows;
}

/**
 * The stored choice after a click on the eye of `row`: a signature's eye
 * checks or unchecks its box in the picker; a group's sets the boxes of
 * the signatures listed under it (`ids`), all shown unless all were (a
 * mixed group shows them all), and leaves its other members as they
 * were. The default set is kept as no choice (`pickerChoice`).
 */
export function choiceAfterEye(
  row: HeaderRow,
  stored: readonly string[] | null,
  catalogue: Pick<SignaturesState, 'list'>,
): string[] | null {
  const picked = pickedIds(stored, catalogue);
  const next =
    row.kind === 'group' ? toggleGroup(row.ids, picked) : toggleSignature(row.id, picked);
  return pickerChoice(next, catalogue);
}
