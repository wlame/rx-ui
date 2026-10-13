import { describe, expectTypeOf, it } from 'vitest';
import type { components } from './types.generated';
import type {
  ChainEntry,
  ChainGap,
  ChainIndexTaskResult,
  ChainMatch,
  ChainPart,
  ChainPiece,
  ChainReason,
  ChainRef,
  ChainResponse,
  ChainSamplesResponse,
  ChainState,
  ChainsResponse,
  ChainTraceResponse,
  CompressTaskResult,
  Finding,
  FindingsResponse,
  FindingsTicks,
  FolderTaskResult,
  GroupInfo,
  HealthResponse,
  IndexResponse,
  IndexTaskResponse,
  IndexTaskResult,
  LineIndexEntry,
  LineLengthStats,
  LoadErrorInfo,
  LongestLine,
  SamplesResponse,
  SignatureInfo,
  SignaturesResponse,
  TaskConflictError,
  TaskState,
  TaskStatus,
  TreeEntry,
  TreeFindings,
  TreeResponse,
} from './types';

/**
 * The wire types must be the generated contract types, or a field the
 * contract allows to be null can reach the app typed as never null.
 * These assertions are checked by `just typecheck`, which reads test
 * files too; at run time they do nothing.
 */
type Schemas = components['schemas'];

describe('wire types', () => {
  it('are the generated contract schemas', () => {
    expectTypeOf<HealthResponse>().toEqualTypeOf<Schemas['HealthResponse']>();
    expectTypeOf<TreeEntry>().toEqualTypeOf<Schemas['TreeEntry']>();
    expectTypeOf<TreeResponse>().toEqualTypeOf<Schemas['TreeResponse']>();
    expectTypeOf<SamplesResponse>().toEqualTypeOf<Schemas['SamplesResponse']>();
    expectTypeOf<IndexTaskResponse>().toEqualTypeOf<Schemas['TaskResponse']>();
  });

  it('type the signature catalogue and the findings with their named schemas', () => {
    expectTypeOf<SignaturesResponse>().toEqualTypeOf<Schemas['SignaturesResponse']>();
    expectTypeOf<SignatureInfo>().toEqualTypeOf<Schemas['SignatureInfo']>();
    expectTypeOf<GroupInfo>().toEqualTypeOf<Schemas['GroupInfo']>();
    expectTypeOf<LoadErrorInfo>().toEqualTypeOf<Schemas['LoadErrorInfo']>();
    expectTypeOf<FindingsResponse>().toEqualTypeOf<Schemas['FindingsResponse']>();
    expectTypeOf<Finding>().toEqualTypeOf<Schemas['Finding']>();
    expectTypeOf<FindingsTicks>().toEqualTypeOf<Schemas['FindingsTicks']>();
    expectTypeOf<TreeFindings>().toEqualTypeOf<Schemas['TreeFindings']>();
  });

  // A tree entry without findings in the cache has none; a file's time
  // and a tick column's span are null when the file has no timestamps.
  it('keep the tree findings, a finding time and the ticks nullable', () => {
    expectTypeOf<TreeEntry['findings']>().toEqualTypeOf<TreeFindings>();
    expectTypeOf<null>().toMatchTypeOf<TreeFindings>();
    expectTypeOf<NonNullable<TreeFindings>['state']>().toEqualTypeOf<'full' | 'partial'>();
    expectTypeOf<Finding['time_ms']>().toEqualTypeOf<number | null>();
    expectTypeOf<FindingsResponse['ticks']>().toEqualTypeOf<FindingsTicks>();
    expectTypeOf<null>().toMatchTypeOf<FindingsTicks>();
  });

  it('type the index answers with their named schemas', () => {
    expectTypeOf<IndexResponse>().toEqualTypeOf<Schemas['IndexResponse']>();
    expectTypeOf<IndexTaskResult>().toEqualTypeOf<Schemas['IndexTaskResult']>();
    expectTypeOf<CompressTaskResult>().toEqualTypeOf<Schemas['CompressTaskResult']>();
    expectTypeOf<LineIndexEntry>().toEqualTypeOf<Schemas['LineIndexEntry']>();
    expectTypeOf<LineLengthStats>().toEqualTypeOf<Schemas['LineLengthStats']>();
    expectTypeOf<LongestLine>().toEqualTypeOf<Schemas['LongestLine']>();
    expectTypeOf<TaskConflictError>().toEqualTypeOf<Schemas['TaskConflictError']>();
  });

  it('type a task result as the contract union, null until the task completes', () => {
    expectTypeOf<TaskStatus>().toEqualTypeOf<Schemas['TaskStatusResponse']>();
    expectTypeOf<TaskStatus['result']>().toEqualTypeOf<
      | IndexTaskResult
      | CompressTaskResult
      | ChainIndexTaskResult
      | FindingsResponse
      | FolderTaskResult
      | null
    >();
    expectTypeOf<FolderTaskResult>().toEqualTypeOf<Schemas['FolderTaskResult']>();
  });

  // The contract types the status as a string; a findings scan or a task
  // over a folder stopped by DELETE /v1/tasks/{task_id} ends `cancelled`.
  it('name every task status, cancelled included', () => {
    expectTypeOf<TaskState>().toMatchTypeOf<TaskStatus['status']>();
    expectTypeOf<'cancelled'>().toMatchTypeOf<TaskState>();
  });

  it('type the log chain answers with their named schemas', () => {
    expectTypeOf<ChainsResponse>().toEqualTypeOf<Schemas['ChainsResponse']>();
    expectTypeOf<ChainEntry>().toEqualTypeOf<Schemas['ChainEntry']>();
    expectTypeOf<ChainResponse>().toEqualTypeOf<Schemas['ChainResponse']>();
    expectTypeOf<ChainPart>().toEqualTypeOf<Schemas['ChainPart']>();
    expectTypeOf<ChainReason>().toEqualTypeOf<Schemas['ChainReason']>();
    expectTypeOf<ChainGap>().toEqualTypeOf<Schemas['ChainGap']>();
    expectTypeOf<ChainSamplesResponse>().toEqualTypeOf<Schemas['ChainSamplesResponse']>();
    expectTypeOf<ChainPiece>().toEqualTypeOf<Schemas['ChainPiece']>();
    expectTypeOf<ChainTraceResponse>().toEqualTypeOf<Schemas['ChainTraceResponse']>();
    expectTypeOf<ChainMatch>().toEqualTypeOf<Schemas['ChainMatch']>();
    expectTypeOf<ChainRef>().toEqualTypeOf<Schemas['ChainRef']>();
    expectTypeOf<ChainIndexTaskResult>().toEqualTypeOf<Schemas['ChainIndexTaskResult']>();
    expectTypeOf<ChainState>().toEqualTypeOf<'pending' | 'ready' | 'invalid'>();
  });

  // A chain of more than 10,000 parts and a chain with unreadable parts
  // are still listed; the listing says so in these fields.
  it('carry the bounded missing names, the unreadable parts and the too-large mark', () => {
    expectTypeOf<ChainEntry['missing_count']>().toEqualTypeOf<number>();
    expectTypeOf<ChainEntry['unreadable']>().toEqualTypeOf<string[]>();
    expectTypeOf<ChainEntry['too_many_parts']>().toEqualTypeOf<boolean>();
    expectTypeOf<ChainResponse['missing_count']>().toEqualTypeOf<number>();
  });

  // Each piece says which part its lines come from, with both numberings.
  it('give each samples piece its part, its numbers and its line times', () => {
    expectTypeOf<ChainPiece['part']>().toEqualTypeOf<string>();
    expectTypeOf<ChainPiece['first_local_line']>().toEqualTypeOf<number>();
    expectTypeOf<ChainPiece['first_global_line']>().toEqualTypeOf<number>();
    expectTypeOf<ChainPiece['line_timestamps']>().toEqualTypeOf<(number | null)[] | null>();
    expectTypeOf<ChainPart['day_first']>().toEqualTypeOf<boolean | null>();
    expectTypeOf<ChainPart['example']>().toEqualTypeOf<string | null>();
  });

  // A seekable-zstd index adds the frame number to each checkpoint.
  it('allow a line-index entry of two or three numbers', () => {
    expectTypeOf<[number, number]>().toMatchTypeOf<LineIndexEntry>();
    expectTypeOf<[number, number, number]>().toMatchTypeOf<LineIndexEntry>();
  });

  // Both are null for a seekable zstd file, whose index has no statistics.
  it('keep the line statistics nullable, and every one but max', () => {
    expectTypeOf<IndexResponse['line_length']>().toEqualTypeOf<LineLengthStats>();
    expectTypeOf<null>().toMatchTypeOf<LineLengthStats>();
    expectTypeOf<null>().toMatchTypeOf<LongestLine>();
    expectTypeOf<NonNullable<LineLengthStats>['max']>().toEqualTypeOf<number>();
    expectTypeOf<NonNullable<LineLengthStats>['p99']>().toEqualTypeOf<number | null>();
  });
});
