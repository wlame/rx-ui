import { describe, expect, it } from 'vitest';
import { journalInfo } from '../testing/journalInfo';
import { journalDamageChip } from './journalDamage';

describe('journalDamageChip', () => {
  it.each([
    { kind: 'a file that is not a journal', journal: null },
    { kind: 'a backend of contract 2.0, which leaves the section out', journal: undefined },
    { kind: 'an undamaged journal', journal: journalInfo() },
    {
      kind: 'a journal with entries that have no message',
      journal: journalInfo({ entries: 100, shown: 90, without_message: 10 }),
    },
  ])('draws no chip for $kind', ({ journal }) => {
    expect(journalDamageChip(journal)).toBeNull();
  });

  it.each([
    { leftOut: 1, notReached: 0, text: '1 damaged entry left out' },
    { leftOut: 3, notReached: 0, text: '3 damaged entries left out' },
    { leftOut: 1_234, notReached: 0, text: '1,234 damaged entries left out' },
    { leftOut: 0, notReached: 1, text: '1 entry not reached' },
    { leftOut: 0, notReached: 5, text: '5 entries not reached' },
    { leftOut: 3, notReached: 1, text: '3 damaged entries left out · 1 entry not reached' },
    { leftOut: 1, notReached: 5, text: '1 damaged entry left out · 5 entries not reached' },
  ])(
    'says "$text" for $leftOut left out and $notReached not reached',
    ({ leftOut, notReached, text }) => {
      const journal = journalInfo({
        left_out: leftOut,
        not_reached: notReached,
        first_damaged_entry: 7,
        damage_reason: 'an entry object is outside the file',
      });

      expect(journalDamageChip(journal)?.text).toBe(text);
    },
  );

  it('puts the reason and the first damaged entry in the tooltip', () => {
    const journal = journalInfo({
      left_out: 2,
      first_damaged_entry: 41,
      damage_reason: 'a data object at offset 4096 is outside the file',
    });

    expect(journalDamageChip(journal)?.title).toBe(
      'a data object at offset 4096 is outside the file\nfirst damaged entry: 41',
    );
  });

  it('leaves out of the tooltip what the index does not say', () => {
    const onlyEntry = journalInfo({ left_out: 2, first_damaged_entry: 41, damage_reason: null });
    const onlyReason = journalInfo({
      left_out: 2,
      first_damaged_entry: null,
      damage_reason: 'a data object is damaged',
    });
    const neither = journalInfo({ left_out: 2, first_damaged_entry: null, damage_reason: null });

    expect(journalDamageChip(onlyEntry)?.title).toBe('first damaged entry: 41');
    expect(journalDamageChip(onlyReason)?.title).toBe('a data object is damaged');
    expect(journalDamageChip(neither)?.title).toBe('Entries of this journal are damaged');
  });
});
