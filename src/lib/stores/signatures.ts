import { get, writable, type Readable } from 'svelte/store';
import { api } from '../api';
import type { GroupInfo, LoadErrorInfo, SignatureInfo } from '../types';
import { backendHas } from './health';

/**
 * The signature catalogue the backend loaded when it started
 * (`GET /v1/signatures`): asked once, on a backend whose `/health` lists
 * `signatures`. Signature ids and group names come from here, never from
 * the viewer's code: a user's own signature files add to them.
 */
export interface SignaturesState {
  /** Whether the catalogue arrived; false before, on a backend without the feature, and after a failed ask. */
  loaded: boolean;
  /**
   * Every loaded signature in catalogue order (group by group, then as
   * loaded), opt-in ones (`default: false`) and the built-ins a user file
   * disabled (`disabled_by` set) included.
   */
  list: SignatureInfo[];
  /** The groups in their order: the built-in ones first. A group's `order` sets its colour. */
  groups: GroupInfo[];
  /** The problems the backend found in the signature files, by file, then line. */
  errors: LoadErrorInfo[];
}

const EMPTY: SignaturesState = { loaded: false, list: [], groups: [], errors: [] };

const state = writable<SignaturesState>(EMPTY);

/** The catalogue; empty until it loaded. */
export const signatures: Readable<SignaturesState> = { subscribe: state.subscribe };

/** The ask in flight, which a second call joins. */
let pending: Promise<void> | null = null;

/** Ask the backend for the catalogue and keep it; a failure is logged and leaves it empty. */
async function fetchCatalogue(): Promise<void> {
  try {
    const answer = await api.getSignatures();
    state.set({
      loaded: true,
      list: answer.signatures,
      groups: answer.groups,
      errors: answer.errors,
    });
  } catch (error) {
    console.error('Failed to load the signature catalogue:', error);
  }
}

/**
 * Load the catalogue, once. Does nothing while the backend does not list
 * `signatures` (before the first `/health` answer too), and nothing once
 * the catalogue loaded; a call while it loads waits for that load. After
 * a failed load the next call asks again.
 */
export function loadSignatures(): Promise<void> {
  if (get(state).loaded || !backendHas('signatures')) return Promise.resolve();
  pending ??= fetchCatalogue().finally(() => {
    pending = null;
  });
  return pending;
}

/**
 * The ids of the default set, in catalogue order: every signature with
 * `default` that no user file disabled. Opt-in signatures run only when a
 * selection names them.
 */
export function defaultSetIds(catalogue: Pick<SignaturesState, 'list'>): string[] {
  return catalogue.list
    .filter((signature) => signature.default && !signature.disabled_by)
    .map((signature) => signature.id);
}
