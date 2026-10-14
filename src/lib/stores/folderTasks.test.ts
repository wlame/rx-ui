// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { health, notifications, settings, tree } from '$lib/stores';
import { commandLog, lastCommand } from '$lib/stores/commands';
import { forgetFindings, refreshFindings } from '$lib/stores/findings';
import { loadSignatures } from '$lib/stores/signatures';
import {
  APP_LOG,
  FOLDER,
  FolderTaskBackend,
  OLD_LOG,
  SUBFOLDER,
  folderResult,
  serveFolderTasks,
} from '$lib/testing/fakeFolderTasks';
import {
  askFolderTask,
  closeFolderTaskRequest,
  folderTaskOf,
  folderTaskRequest,
  folderTaskStage,
  startFolderTask,
  stopFolderTask,
} from './folderTasks';

const POLL_INTERVAL = 1000;

let backend: FolderTaskBackend;

/** A backend listing `/logs`, with the catalogue loaded and the root's rows in the tree. */
async function serve(features?: string[]) {
  backend = new FolderTaskBackend({ features });
  serveFolderTasks(backend);
  await health.check();
  await loadSignatures();
  await tree.loadRoots();
}

/** Let the polls and the stubbed requests settle, one poll interval at a time. */
async function settle(intervals = 2) {
  for (let i = 0; i < intervals; i++) await vi.advanceTimersByTimeAsync(POLL_INTERVAL);
}

/** The notifications on screen, as `[type, message]`. */
function shown(): [string, string][] {
  return get(notifications).map((n) => [n.type, n.message]);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  for (const task of backend?.tasks.values() ?? []) {
    if (['queued', 'running', 'cancelling'].includes(task.status)) backend.complete(task.id);
  }
  await settle();
  for (const n of get(notifications)) notifications.dismiss(n.id);
  closeFolderTaskRequest();
  forgetFindings([]);
  commandLog.clear();
  settings.update((s) => ({ ...s, findingsPicker: null }));
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('startFolderTask', () => {
  it('starts one index task over the folder, for files of any size, and shows its command at once', async () => {
    await serve();

    const done = startFolderTask(FOLDER, 'index');
    await vi.advanceTimersByTimeAsync(0);

    expect(backend.requestsTo('POST', '/v1/index').map((r) => r.body)).toEqual([
      { path: FOLDER, force: false, threshold: 0 },
    ]);
    expect(get(lastCommand)).toMatchObject({
      command: `rx index ${FOLDER} --recursive --threshold=0 --hidden`,
      action: 'index',
    });
    expect(folderTaskOf(FOLDER)).toMatchObject({ kind: 'index', taskId: backend.lastTask().id });
    backend.complete(backend.lastTask().id);
    await settle();
    await done;
  });

  it("scans the folder with the picker's choice and shows its rx scan command at once", async () => {
    await serve();
    settings.update((s) => ({ ...s, findingsPicker: ['sql-statement'] }));

    void startFolderTask(FOLDER, 'findings');
    await vi.advanceTimersByTimeAsync(0);

    expect(backend.requestsTo('POST', '/v1/findings').map((r) => r.body)).toEqual([
      { path: FOLDER, signatures: 'sql-statement', force: false },
    ]);
    expect(get(lastCommand)).toMatchObject({
      command: `rx scan ${FOLDER} --recursive --signatures=sql-statement --hidden`,
      action: 'findings',
    });
  });

  it('sends the default set by name when the picker is the default set', async () => {
    await serve();

    void startFolderTask(FOLDER, 'findings');
    await vi.advanceTimersByTimeAsync(0);

    expect(backend.requestsTo('POST', '/v1/findings').map((r) => r.body)).toEqual([
      { path: FOLDER, signatures: 'default', force: false },
    ]);
    expect(get(lastCommand)?.command).toContain('--signatures=default');
  });

  it('scans nothing when the picker picks no signature, and says so', async () => {
    await serve();
    settings.update((s) => ({ ...s, findingsPicker: [] }));

    await startFolderTask(FOLDER, 'findings');

    expect(backend.requestsTo('POST', '/v1/findings')).toEqual([]);
    expect(shown()).toEqual([['warning', 'Pick signatures in the Findings panel to scan logs/']]);
    expect(folderTaskOf(FOLDER)).toBeNull();
  });

  it('starts no scan on a backend that does not serve signatures', async () => {
    await serve([]);

    const done = startFolderTask(FOLDER, 'findings');
    await vi.advanceTimersByTimeAsync(0);

    expect(backend.requestsTo('POST', '/v1/findings')).toEqual([]);
    expect(folderTaskOf(FOLDER)).toBeNull();
    await done;
  });

  it('follows a task of each of two folders at once, each to its own end', async () => {
    await serve();
    const outer = startFolderTask(FOLDER, 'findings');
    const inner = startFolderTask(SUBFOLDER, 'index');
    await vi.advanceTimersByTimeAsync(0);
    const taskOf = (kind: string) => [...backend.tasks.values()].find((t) => t.kind === kind);
    const [scan, index] = [taskOf('findings'), taskOf('index')];
    if (!scan || !index) throw new Error('the two tasks did not start');
    backend.progress(scan.id, 1, 4);
    backend.progress(index.id, 0, 1);
    await settle(1);

    expect(folderTaskOf(FOLDER)).toMatchObject({ kind: 'findings', taskId: scan.id, filesDone: 1 });
    expect(folderTaskOf(SUBFOLDER)).toMatchObject({
      kind: 'index',
      taskId: index.id,
      filesDone: 0,
    });

    backend.complete(index.id, folderResult({ path: SUBFOLDER, files_total: 1, done: 1 }));
    await settle();
    await inner;

    expect(folderTaskOf(SUBFOLDER)).toBeNull();
    expect(folderTaskOf(FOLDER)?.taskId).toBe(scan.id);
    expect(shown()).toEqual([['success', 'Indexed 1 file under sub/']]);

    backend.complete(scan.id, folderResult({ files_total: 4, done: 4 }));
    await settle();
    await outer;

    expect(folderTaskOf(FOLDER)).toBeNull();
    expect(shown()).toEqual([
      ['success', 'Indexed 1 file under sub/'],
      ['success', 'Scanned 4 files under logs/'],
    ]);
  });

  it('is starting until the backend names the task, then running, then none', async () => {
    await serve();

    const done = startFolderTask(FOLDER, 'index');

    expect(folderTaskStage(FOLDER)).toBe('starting');
    await vi.advanceTimersByTimeAsync(0);
    expect(folderTaskStage(FOLDER)).toBe('running');
    backend.complete(backend.lastTask().id);
    await settle();
    await done;
    expect(folderTaskStage(FOLDER)).toBe('none');
  });

  it('follows the files done and the total of the folder', async () => {
    await serve();
    void startFolderTask(FOLDER, 'findings');
    await vi.advanceTimersByTimeAsync(0);
    expect(folderTaskOf(FOLDER)).toMatchObject({ filesDone: null, filesTotal: null });

    backend.progress(backend.lastTask().id, 12, 214);
    await settle(1);

    expect(folderTaskOf(FOLDER)).toMatchObject({
      kind: 'findings',
      filesDone: 12,
      filesTotal: 214,
      isStopping: false,
    });
  });

  it('starts nothing while a task of the folder is followed', async () => {
    await serve();

    void startFolderTask(FOLDER, 'index');
    void startFolderTask(FOLDER, 'findings');
    await vi.advanceTimersByTimeAsync(0);

    expect(backend.requestsTo('POST', '/v1/index')).toHaveLength(1);
    expect(backend.requestsTo('POST', '/v1/findings')).toEqual([]);
  });

  it('follows the index task a 409 names for the folder, and shows its command', async () => {
    await serve();
    const running = backend.startElsewhere('index', FOLDER);

    void startFolderTask(FOLDER, 'index');
    await vi.advanceTimersByTimeAsync(0);

    expect(folderTaskOf(FOLDER)?.taskId).toBe(running.id);
    expect(backend.requestsTo('GET', `/v1/tasks/${running.id}`).length).toBeGreaterThan(0);
    expect(get(lastCommand)?.command).toBe(`rx index ${FOLDER} --recursive --threshold=0 --hidden`);
    expect(shown().filter(([type]) => type === 'error')).toEqual([]);
  });

  it('says why the backend refused to start the task', async () => {
    await serve();
    vi.spyOn(backend, 'fetch').mockImplementationOnce(async () => ({
      ok: false,
      status: 403,
      statusText: '403',
      json: async () => ({ detail: 'hidden entry refused' }),
      text: async () => JSON.stringify({ detail: 'hidden entry refused' }),
    }));

    await startFolderTask(FOLDER, 'index');

    expect(shown()).toEqual([['error', expect.stringContaining('hidden entry refused')]]);
    expect(folderTaskOf(FOLDER)).toBeNull();
  });
});

describe('the end of a folder task', () => {
  it("reads the folder's loaded rows again, keeps open folders open and shows the new labels", async () => {
    await serve();
    await tree.expand(SUBFOLDER);
    const done = startFolderTask(FOLDER, 'findings');
    await vi.advanceTimersByTimeAsync(0);
    backend.setLabels(APP_LOG, { findings: { state: 'full', count: 4 } });
    backend.setLabels(OLD_LOG, { findings: { state: 'partial', count: 1 } });
    const listedBefore = backend.listingsAsked().length;

    backend.complete(backend.lastTask().id);
    await settle();
    await done;

    expect(backend.listingsAsked().slice(listedBefore).sort()).toEqual([FOLDER, SUBFOLDER]);
    expect(tree.nodeAt(APP_LOG)?.findings).toEqual({ state: 'full', count: 4 });
    expect(tree.nodeAt(OLD_LOG)?.findings).toEqual({ state: 'partial', count: 1 });
    expect(tree.nodeAt(SUBFOLDER)?.expanded).toBe(true);
    expect(folderTaskOf(FOLDER)).toBeNull();
  });

  it('reads no folder the panel has not loaded', async () => {
    await serve();
    const done = startFolderTask(FOLDER, 'index');
    await vi.advanceTimersByTimeAsync(0);
    backend.setLabels(APP_LOG, { is_indexed: true });
    const listedBefore = backend.listingsAsked().length;

    backend.complete(backend.lastTask().id);
    await settle();
    await done;

    expect(backend.listingsAsked().slice(listedBefore)).toEqual([FOLDER]);
    expect(tree.nodeAt(APP_LOG)?.is_indexed).toBe(true);
    expect(tree.nodeAt(SUBFOLDER)?.expanded).toBe(false);
  });

  it('says what a completed scan did', async () => {
    await serve();
    const done = startFolderTask(FOLDER, 'findings');
    await vi.advanceTimersByTimeAsync(0);
    const task = backend.lastTask();

    backend.complete(
      task.id,
      folderResult({ files_total: 214, done: 210, skipped: 3, failed: 1, findings: 7 }),
    );
    await settle();
    await done;

    expect(shown()).toEqual([['warning', 'Scanned 210 files under logs/, skipped 3, failed 1']]);
  });

  it('reads again the findings of a file under the folder that the findings store holds', async () => {
    await serve();
    await refreshFindings(APP_LOG);
    const readsOf = () =>
      backend.requestsTo('GET', '/v1/findings').filter((r) => r.query.get('path') === APP_LOG)
        .length;
    const readsBefore = readsOf();
    const done = startFolderTask(FOLDER, 'findings');
    await vi.advanceTimersByTimeAsync(0);

    backend.complete(backend.lastTask().id);
    await settle();
    await done;

    expect(readsOf()).toBeGreaterThan(readsBefore);
  });

  it('says it lost track of a task whose status reads keep failing, and reads the rows again', async () => {
    await serve();
    const done = startFolderTask(FOLDER, 'findings');
    await vi.advanceTimersByTimeAsync(0);
    const listedBefore = backend.listingsAsked().length;

    backend.failStatusReads = true;
    await settle(4);
    await done;

    expect(shown()).toEqual([['error', 'Lost track of the scan of logs/: the task table is busy']]);
    expect(backend.listingsAsked().slice(listedBefore)).toEqual([FOLDER]);
    expect(folderTaskOf(FOLDER)).toBeNull();
    backend.failStatusReads = false;
  });

  it('says why a failed task failed, and reads the rows again', async () => {
    await serve();
    const done = startFolderTask(FOLDER, 'findings');
    await vi.advanceTimersByTimeAsync(0);
    const listedBefore = backend.listingsAsked().length;

    backend.fail(backend.lastTask().id, 'disk full');
    await settle();
    await done;

    expect(shown()).toEqual([['error', 'Scanning logs/ failed: disk full']]);
    expect(backend.listingsAsked().slice(listedBefore)).toEqual([FOLDER]);
    expect(folderTaskOf(FOLDER)).toBeNull();
  });
});

describe('stopFolderTask', () => {
  it('sends one DELETE, shows the folder stopping, and says where it stopped once it ends', async () => {
    await serve();
    const done = startFolderTask(FOLDER, 'findings');
    await vi.advanceTimersByTimeAsync(0);
    const task = backend.lastTask();
    backend.progress(task.id, 12, 214);
    await settle(1);

    await stopFolderTask(FOLDER);

    expect(backend.requestsTo('DELETE', `/v1/tasks/${task.id}`)).toHaveLength(1);
    expect(folderTaskOf(FOLDER)?.isStopping).toBe(true);
    const listedBefore = backend.listingsAsked().length;

    await settle();
    await done;

    expect(folderTaskOf(FOLDER)).toBeNull();
    expect(shown()).toEqual([['info', 'Stopped scanning logs/ after 12 of 214 files']]);
    expect(backend.listingsAsked().slice(listedBefore)).toEqual([FOLDER]);
  });

  // rx-go keeps a stopped folder task `cancelling` until its worker
  // stops, and it holds the folder until then.
  it('shows the folder stopping while the backend reports its task cancelling', async () => {
    await serve();
    backend.cancelSlowly = true;
    const done = startFolderTask(FOLDER, 'index');
    await vi.advanceTimersByTimeAsync(0);
    const task = backend.lastTask();

    await stopFolderTask(FOLDER);
    await settle();

    expect(task.status).toBe('cancelling');
    expect(folderTaskOf(FOLDER)?.isStopping).toBe(true);
    expect(shown()).toEqual([]);

    backend.finishCancel(task.id);
    await settle();
    await done;

    expect(folderTaskOf(FOLDER)).toBeNull();
    expect(shown()).toEqual([['info', 'Stopped indexing logs/']]);
  });

  it('shows the folder stopping when its task was stopped elsewhere', async () => {
    await serve();
    backend.cancelSlowly = true;
    void startFolderTask(FOLDER, 'findings');
    await vi.advanceTimersByTimeAsync(0);
    const task = backend.lastTask();

    task.status = 'cancelling';
    await settle(1);

    expect(folderTaskOf(FOLDER)?.isStopping).toBe(true);
  });

  it('says a folder whose stopped task has not ended is still stopping, and starts nothing', async () => {
    await serve();
    backend.cancelSlowly = true;
    const stopped = backend.startElsewhere('findings', FOLDER);
    stopped.status = 'cancelling';

    await startFolderTask(FOLDER, 'findings');

    expect(shown()).toEqual([
      ['info', 'The scan of logs/ is still stopping; try again in a moment'],
    ]);
    expect(folderTaskOf(FOLDER)).toBeNull();
    backend.finishCancel(stopped.id);
  });

  // The folder is free once the stopped task has ended, which may happen
  // between the 409 and the read of its status.
  it('starts once more when the stopped task a 409 names has ended by its status read', async () => {
    await serve();
    const stopped = backend.startElsewhere('index', FOLDER);
    stopped.status = 'cancelling';
    backend.endStoppedOnRead = true;

    const done = startFolderTask(FOLDER, 'index');
    await vi.advanceTimersByTimeAsync(0);

    expect(backend.requestsTo('POST', '/v1/index')).toHaveLength(2);
    const task = backend.lastTask();
    expect(task.id).not.toBe(stopped.id);
    expect(folderTaskOf(FOLDER)?.taskId).toBe(task.id);
    backend.complete(task.id, folderResult({ files_total: 1, done: 1 }));
    await settle();
    await done;

    expect(shown()).toEqual([['success', 'Indexed 1 file under logs/']]);
  });

  it('says to try again when a 409 still names a task no status read knows, after one more start', async () => {
    await serve();
    backend.conflictWith = 'forgotten-1';

    await startFolderTask(FOLDER, 'index');

    expect(backend.requestsTo('POST', '/v1/index')).toHaveLength(2);
    expect(shown()).toEqual([
      ['info', 'The index task of logs/ is still stopping; try again in a moment'],
    ]);
    expect(folderTaskOf(FOLDER)).toBeNull();
  });

  it('leaves a task that ended meanwhile (409) to its poll, and reports its end', async () => {
    await serve();
    const done = startFolderTask(FOLDER, 'index');
    await vi.advanceTimersByTimeAsync(0);
    const task = backend.lastTask();
    backend.cancelConflict = true;

    await stopFolderTask(FOLDER);

    expect(folderTaskOf(FOLDER)?.isStopping).toBe(false);
    backend.complete(task.id, folderResult({ files_total: 2, done: 2 }));
    await settle();
    await done;

    expect(shown()).toEqual([['success', 'Indexed 2 files under logs/']]);
  });

  it('leaves a task the backend forgot (404) to its poll, which says it has ended', async () => {
    await serve();
    const done = startFolderTask(FOLDER, 'index');
    await vi.advanceTimersByTimeAsync(0);
    const task = backend.lastTask();
    backend.forget(task.id);

    await stopFolderTask(FOLDER);

    expect(backend.requestsTo('DELETE', `/v1/tasks/${task.id}`)).toHaveLength(1);
    expect(shown()).toEqual([]);
    await settle();
    await done;

    expect(shown()).toEqual([['info', 'The index task of logs/ has ended']]);
    expect(folderTaskOf(FOLDER)).toBeNull();
  });

  it('says why the backend refused to stop the task, and keeps following it', async () => {
    await serve();
    const done = startFolderTask(FOLDER, 'index');
    await vi.advanceTimersByTimeAsync(0);
    const task = backend.lastTask();
    backend.cancelError = 500;

    await stopFolderTask(FOLDER);

    expect(shown()).toEqual([
      ['error', 'Cannot stop the index task of logs/: the task table is busy'],
    ]);
    expect(folderTaskOf(FOLDER)).toMatchObject({ taskId: task.id, isStopping: false });
    backend.complete(task.id);
    await settle();
    await done;
  });

  it('sends nothing for a folder whose task is not followed', async () => {
    await serve();

    await stopFolderTask(FOLDER);

    expect(backend.requestsTo('DELETE', '/v1/tasks/x')).toEqual([]);
    expect(backend.requests.filter((r) => r.method === 'DELETE')).toEqual([]);
  });
});

describe('askFolderTask', () => {
  it('asks to confirm a scan of the folder with the number of signatures picked', async () => {
    await serve();
    settings.update((s) => ({ ...s, findingsPicker: ['sql-statement', 'aws-access-key'] }));

    await askFolderTask(FOLDER, 'findings');

    expect(get(folderTaskRequest)).toEqual({ path: FOLDER, kind: 'findings', signatureCount: 2 });
    expect(backend.requests.filter((r) => r.method === 'POST')).toEqual([]);
  });

  it('asks to confirm an index of the folder', async () => {
    await serve();

    await askFolderTask(FOLDER, 'index');

    expect(get(folderTaskRequest)).toEqual({ path: FOLDER, kind: 'index', signatureCount: null });
  });

  it('asks nothing and says so when the picker picks no signature', async () => {
    await serve();
    settings.update((s) => ({ ...s, findingsPicker: [] }));

    await askFolderTask(FOLDER, 'findings');

    expect(get(folderTaskRequest)).toBeNull();
    expect(shown()).toEqual([['warning', 'Pick signatures in the Findings panel to scan logs/']]);
  });
});
