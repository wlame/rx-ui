import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { GroupInfo, LoadErrorInfo, SignatureInfo, SignaturesResponse } from '../types';
import type { SignaturesState } from './signatures';

/** A catalogue signature with the fields the store reads; the rest minimal. */
function signature(id: string, fields: Partial<SignatureInfo> = {}): SignatureInfo {
  return {
    id,
    name: id,
    group: 'traceback',
    description: '',
    tags: [],
    level: 'high',
    links: [],
    metadata: {},
    default: true,
    redact: false,
    kind: 'regex',
    keywords: [],
    keywords_declared: false,
    line_pass: false,
    source: { builtin: true },
    overrides: false,
    disabled_by: null,
    examples: { match: [], no_match: [] },
    regex: null,
    block: null,
    run: null,
    measure: null,
    ...fields,
  };
}

const GROUPS: GroupInfo[] = [
  { name: 'traceback', description: '', order: 1, count: 2, builtin: true },
  { name: 'pii', description: '', order: 4, count: 1, builtin: true },
];

const ERRORS: LoadErrorInfo[] = [
  { file: '/home/u/.config/rx/signatures/team.yml', line: 12, id: 'bad', message: 'no regex' },
];

const CATALOGUE: SignaturesResponse = {
  signatures: [signature('python-traceback'), signature('email-address', { default: false })],
  groups: GROUPS,
  levels: ['info', 'low', 'medium', 'high', 'critical'],
  errors: ERRORS,
  search_path: [],
  files: [],
};

/**
 * A backend whose `/health` lists `features` and whose `/v1/signatures`
 * gives `catalogue`, or fails with a 500 while `failing` holds. Every
 * requested path is recorded.
 */
function serveBackend(features: string[], catalogue: SignaturesResponse = CATALOGUE) {
  const backend = { paths: [] as string[], failing: false };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = new URL(url, 'http://localhost').pathname;
      backend.paths.push(path);
      const isFailure = path === '/v1/signatures' && backend.failing;
      const body =
        path === '/health' ? { status: 'ok', contract_version: '2.0', features } : catalogue;
      return {
        ok: !isFailure,
        status: isFailure ? 500 : 200,
        statusText: isFailure ? 'Internal Server Error' : 'OK',
        json: async () => body,
        text: async () => (isFailure ? '{"detail":"boom"}' : JSON.stringify(body)),
      };
    }),
  );
  return backend;
}

/** The health and catalogue stores, fresh for each test, after one `/health` answer. */
async function freshStores() {
  const { health } = await import('./health');
  const store = await import('./signatures');
  await health.check();
  return store;
}

const catalogueRequests = (paths: string[]) => paths.filter((p) => p === '/v1/signatures');

describe('the signature catalogue', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('loads once, however often and however soon it is asked', async () => {
    const backend = serveBackend(['signatures']);
    const { loadSignatures, signatures } = await freshStores();

    await Promise.all([loadSignatures(), loadSignatures()]);
    await loadSignatures();

    expect(catalogueRequests(backend.paths)).toHaveLength(1);
    expect(get(signatures)).toEqual({
      loaded: true,
      list: CATALOGUE.signatures,
      groups: GROUPS,
      errors: ERRORS,
    });
  });

  it('stays empty and asks nothing of a backend without the signatures feature', async () => {
    const backend = serveBackend(['log_chains']);
    const { loadSignatures, signatures } = await freshStores();

    await loadSignatures();

    expect(catalogueRequests(backend.paths)).toEqual([]);
    expect(get(signatures)).toEqual({ loaded: false, list: [], groups: [], errors: [] });
  });

  // The first /health answer comes after the app starts; a backend
  // replaced by one that serves signatures is asked then.
  it('asks nothing before /health has answered', async () => {
    const backend = serveBackend(['signatures']);
    const { loadSignatures, signatures } = await import('./signatures');

    await loadSignatures();

    expect(catalogueRequests(backend.paths)).toEqual([]);
    expect(get(signatures).loaded).toBe(false);
  });

  it('stays empty after a failed load, and asks again on the next call', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const backend = serveBackend(['signatures']);
    backend.failing = true;
    const { loadSignatures, signatures } = await freshStores();

    await loadSignatures();
    expect(get(signatures).loaded).toBe(false);
    backend.failing = false;
    await loadSignatures();

    expect(catalogueRequests(backend.paths)).toHaveLength(2);
    expect(get(signatures).loaded).toBe(true);
  });
});

describe('defaultSetIds', () => {
  afterEach(() => vi.resetModules());

  // The backend lists the built-ins a user file disabled, and the opt-in
  // signatures; neither is in the default set.
  it('names the default set in catalogue order, without opt-in and disabled signatures', async () => {
    const { defaultSetIds } = await import('./signatures');
    const list = [
      signature('java-exception'),
      signature('email-address', { group: 'pii', default: false }),
      signature('go-panic', {
        disabled_by: { file: '/home/u/.config/rx/signatures/team.yml', line: 3 },
      }),
      signature('python-traceback'),
    ];

    const loaded: SignaturesState = { loaded: true, list, groups: GROUPS, errors: [] };

    expect(defaultSetIds(loaded)).toEqual(['java-exception', 'python-traceback']);
  });

  it('names nothing before the catalogue has loaded', async () => {
    const { defaultSetIds } = await import('./signatures');

    const empty: SignaturesState = { loaded: false, list: [], groups: [], errors: [] };

    expect(defaultSetIds(empty)).toEqual([]);
  });
});
