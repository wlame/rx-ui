/**
 * The warning the editor header shows for a systemd journal whose index
 * records damage: entries the text leaves out because an object of
 * theirs cannot be read, and entries after the place where the journal's
 * entry list breaks off, which no read can reach.
 */
import type { JournalInfo } from '../types';
import { formatCount } from './format';

/** The chip's text and its tooltip, which starts with that text. */
export interface JournalDamageChip {
  text: string;
  title: string;
}

type JournalSection = NonNullable<JournalInfo>;

/** What the chip says of each kind of damage: the entries it counts and the words for them. */
const DAMAGE_CLAUSES: readonly {
  count: (journal: JournalSection) => number;
  words: (count: number) => string;
}[] = [
  {
    count: (journal) => journal.left_out,
    words: (count) => `${formatCount(count, 'damaged entry', 'damaged entries')} left out`,
  },
  {
    count: (journal) => journal.not_reached,
    words: (count) => `${formatCount(count, 'entry', 'entries')} not reached`,
  },
];

/**
 * The tooltip's lines: the chip's own text, which a narrow pane cuts, then
 * the reason the index gives and the first damaged entry. A line the index
 * does not give is left out, so the text alone is a whole tooltip.
 */
function damageTitle(text: string, journal: JournalSection): string {
  const lines = [
    text,
    journal.damage_reason,
    journal.first_damaged_entry === null
      ? null
      : `first damaged entry: ${journal.first_damaged_entry}`,
  ].filter((line): line is string => line !== null && line !== '');
  return lines.join('\n');
}

/**
 * The chip for `journal` (the `journal` section of a file's index), or
 * null when there is nothing to warn of: the file is not a journal, the
 * backend knows no journals (it leaves the section out, so it is
 * undefined), or no entry was left out or missed. Entries with no
 * MESSAGE are not damage; journalctl shows none of them either.
 */
export function journalDamageChip(journal: JournalInfo | undefined): JournalDamageChip | null {
  if (!journal) return null;
  const said = DAMAGE_CLAUSES.filter((clause) => clause.count(journal) > 0).map((clause) =>
    clause.words(clause.count(journal)),
  );
  if (said.length === 0) return null;
  const text = said.join(' · ');
  return { text, title: damageTitle(text, journal) };
}
