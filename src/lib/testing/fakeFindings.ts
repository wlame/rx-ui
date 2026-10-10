/**
 * Invented signatures, findings and findings answers for tests: a small
 * catalogue of four groups (`traceback`, `secret`, `sql`, `pii`), with
 * two opt-in `pii` signatures and one built-in a user file disabled.
 */
import type { SignaturesState } from '../stores/signatures';
import type { Finding, FindingsResponse, GroupInfo, SignatureInfo } from '../types';

/** A catalogue signature with every field set; `fields` overrides any. */
export function signatureInfo(id: string, fields: Partial<SignatureInfo> = {}): SignatureInfo {
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

export const TEST_GROUPS: GroupInfo[] = [
  { name: 'traceback', description: 'Stack traces', order: 1, count: 3, builtin: true },
  { name: 'secret', description: 'Keys and tokens', order: 2, count: 1, builtin: true },
  { name: 'sql', description: 'SQL statements', order: 3, count: 1, builtin: true },
  { name: 'pii', description: 'Personal data', order: 4, count: 2, builtin: true },
];

/** The catalogue in its order: group by group. */
export const TEST_SIGNATURES: SignatureInfo[] = [
  signatureInfo('python-traceback', { name: 'Python traceback', kind: 'block' }),
  signatureInfo('java-exception', { name: 'Java exception', kind: 'block' }),
  signatureInfo('legacy-trace', {
    name: 'Legacy trace',
    disabled_by: { file: '/home/u/.config/rx/signatures/team.yml', line: 3 },
  }),
  signatureInfo('aws-access-key', { name: 'AWS access key', group: 'secret', redact: true }),
  signatureInfo('sql-statement', { name: 'SQL statement', group: 'sql', level: 'info' }),
  signatureInfo('email-address', { name: 'Email address', group: 'pii', default: false }),
  signatureInfo('phone-number', { name: 'Phone number', group: 'pii', default: false }),
];

/** The ids of the default set of the test catalogue. */
export const TEST_DEFAULT_IDS = [
  'python-traceback',
  'java-exception',
  'aws-access-key',
  'sql-statement',
];

/** The test catalogue as the signatures store holds it once loaded. */
export function testCatalogue(): SignaturesState {
  return { loaded: true, list: TEST_SIGNATURES, groups: TEST_GROUPS, errors: [] };
}

/** A finding of `signature` on lines `start` to `end` (one line by default). */
export function finding(
  signature: string,
  start: number,
  end = start,
  fields: Partial<Finding> = {},
): Finding {
  return {
    signature,
    start_line: start,
    end_line: end,
    start_offset: start * 100,
    end_offset: end * 100 + 99,
    time_ms: null,
    excerpt: `LINE ${start} ${signature}`,
    ...fields,
  };
}

/** A findings answer: nothing checked and nothing found unless `fields` says so. */
export function findingsAnswer(fields: Partial<FindingsResponse> = {}): FindingsResponse {
  return {
    state: 'none',
    checked: [],
    missing: [],
    counts: {},
    series: {},
    total: 0,
    findings: [],
    ticks: null,
    cli_command: '',
    ...fields,
  };
}
