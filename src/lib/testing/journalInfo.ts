/**
 * A builder of the `journal` section of an index for tests: an undamaged
 * archived journal of 100 entries with every field set, and any field
 * given by the test.
 */
import type { JournalInfo } from '../types';

/** What an index records of a systemd journal; `journal` is null for any other file. */
export type JournalSection = NonNullable<JournalInfo>;

export function journalInfo(fields: Partial<JournalSection> = {}): JournalSection {
  return {
    entries: 100,
    shown: 100,
    without_message: 0,
    left_out: 0,
    not_reached: 0,
    first_damaged_entry: null,
    damage_reason: null,
    state: 'archived',
    compact: true,
    seqnum_id: '0123456789abcdef0123456789abcdef',
    head_seqnum: 1,
    tail_seqnum: 100,
    ...fields,
  };
}
