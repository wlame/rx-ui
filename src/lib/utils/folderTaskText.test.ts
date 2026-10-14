import { describe, expect, it } from 'vitest';
import { folderResult } from '$lib/testing/fakeFolderTasks';
import {
  folderName,
  folderTaskEndMessage,
  folderTaskLabel,
  folderTaskQuestion,
  folderTaskStillStopping,
} from './folderTaskText';

describe('folderName', () => {
  it('names a folder by its last part and a slash', () => {
    expect(folderName('/var/log/app')).toBe('app/');
    expect(folderName('/var/log/app/')).toBe('app/');
    expect(folderName('/')).toBe('/');
  });
});

describe('folderTaskLabel', () => {
  it.each([
    ['findings', 12, 214, false, 'scanning 12/214'],
    ['index', 3, 40, false, 'indexing 3/40'],
    ['findings', null, null, false, 'scanning…'],
    ['index', null, null, false, 'indexing…'],
    ['findings', 12, 214, true, 'stopping…'],
  ] as const)(
    'labels a %s task at %s of %s, stopping=%s, as %j',
    (kind, done, total, isStopping, label) => {
      expect(folderTaskLabel({ kind, filesDone: done, filesTotal: total, isStopping })).toBe(label);
    },
  );
});

describe('folderTaskQuestion', () => {
  it('names the folder in the question of each kind', () => {
    expect(folderTaskQuestion('findings', '/srv/logs')).toBe('Scan every file under logs/?');
    expect(folderTaskQuestion('index', '/srv/logs')).toBe('Index every file under logs/?');
  });
});

describe('folderTaskEndMessage', () => {
  it('says what a completed scan did, with the skipped and failed files', () => {
    const result = folderResult({ files_total: 214, done: 210, skipped: 3, failed: 1 });

    expect(folderTaskEndMessage('findings', '/srv/logs', { kind: 'completed', result })).toEqual({
      tone: 'warning',
      message: 'Scanned 210 files under logs/, skipped 3, failed 1',
    });
  });

  it('counts the files that were up to date apart from the other skipped ones', () => {
    const result = folderResult({ files_total: 40, done: 1, skipped: 39, current: 37 });

    expect(folderTaskEndMessage('index', '/srv/logs', { kind: 'completed', result })).toEqual({
      tone: 'success',
      message: 'Indexed 1 file under logs/, 37 up to date, skipped 2',
    });
  });

  it('says where a stopped task stopped', () => {
    expect(
      folderTaskEndMessage('findings', '/srv/logs', {
        kind: 'cancelled',
        filesDone: 12,
        filesTotal: 214,
      }),
    ).toEqual({ tone: 'info', message: 'Stopped scanning logs/ after 12 of 214 files' });
    expect(
      folderTaskEndMessage('index', '/srv/logs', {
        kind: 'cancelled',
        filesDone: null,
        filesTotal: null,
      }),
    ).toEqual({ tone: 'info', message: 'Stopped indexing logs/' });
  });

  it("says why a task failed, with the backend's error", () => {
    expect(
      folderTaskEndMessage('index', '/srv/logs', { kind: 'failed', error: 'disk full' }),
    ).toEqual({ tone: 'error', message: 'Indexing logs/ failed: disk full' });
  });

  it('says a task the backend no longer knows has ended', () => {
    expect(folderTaskEndMessage('findings', '/srv/logs', { kind: 'gone' })).toEqual({
      tone: 'info',
      message: 'The scan of logs/ has ended',
    });
  });
});

describe('folderTaskStillStopping', () => {
  it('asks to try again once the stopped task has ended', () => {
    expect(folderTaskStillStopping('index', '/srv/logs')).toBe(
      'The index task of logs/ is still stopping; try again in a moment',
    );
  });
});
