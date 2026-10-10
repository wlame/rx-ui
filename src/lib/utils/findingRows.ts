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
 */
import type { SignaturesState } from '../stores/signatures';
import type { Finding, FindingsResponse } from '../types';

export type FindingRow =
  | { kind: 'group'; group: string; count: number; collapsed: boolean }
  | { kind: 'signature'; id: string; count: number; stored: number; collapsed: boolean }
  | { kind: 'finding'; finding: Finding; index: number }
  | { kind: 'placeholder'; signature: string | null; index: number };

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
    ? { kind: 'finding', finding: found, index }
    : { kind: 'placeholder', signature: null, index };
}

/** The rows of one expanded signature: its loaded findings, a placeholder for each other. */
function findingRows(id: string, list: readonly Finding[] | undefined): FindingRow[] {
  // Before its first page arrives the length of a filtered list is not
  // known: one placeholder stands for it.
  if (list === undefined) return [{ kind: 'placeholder', signature: id, index: 0 }];
  const rows: FindingRow[] = [];
  for (let index = 0; index < list.length; index++) {
    const found = list[index];
    rows.push(
      found
        ? { kind: 'finding', finding: found, index }
        : { kind: 'placeholder', signature: id, index },
    );
  }
  return rows;
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
  catalogue: Pick<SignaturesState, 'list' | 'groups'>,
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
 * The rows of the group view: each group in catalogue order with the
 * sum of its signatures' counts, then, unless the group is collapsed,
 * each of its signatures with findings, in catalogue order, with its
 * count and how many of them are stored, then, unless the signature is
 * collapsed, its findings as loaded in `pages` (by signature id).
 * `collapsed` holds the keys of the collapsed headers (`groupKey`,
 * `signatureKey`). A signature without findings, and a group left without
 * a signature, has no row. A signature the catalogue does not name comes
 * last, under a group with no name.
 */
export function groupRows(
  summary: Pick<FindingsResponse, 'checked' | 'counts'>,
  pages: ReadonlyMap<string, readonly Finding[]>,
  collapsed: ReadonlySet<string>,
  catalogue: Pick<SignaturesState, 'list' | 'groups'>,
): FindingRow[] {
  const rows: FindingRow[] = [];
  const withFindings = summary.checked.filter((id) => (summary.counts[id]?.count ?? 0) > 0);
  for (const [group, ids] of idsByGroup(withFindings, catalogue)) {
    const isGroupCollapsed = collapsed.has(groupKey(group));
    const count = ids.reduce((sum, id) => sum + (summary.counts[id]?.count ?? 0), 0);
    rows.push({ kind: 'group', group, count, collapsed: isGroupCollapsed });
    if (isGroupCollapsed) continue;
    for (const id of ids) {
      const { count: found, stored } = summary.counts[id];
      const isCollapsed = collapsed.has(signatureKey(id));
      rows.push({ kind: 'signature', id, count: found, stored, collapsed: isCollapsed });
      if (!isCollapsed) rows.push(...findingRows(id, pages.get(id)));
    }
  }
  return rows;
}
