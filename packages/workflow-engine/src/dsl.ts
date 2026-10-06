export { isJson, measureOf, mostValueDepth, type Json, type JsonObject } from './dsl/json.ts';
export {
  compileProgram,
  lineOf,
  type CompiledProgram,
  type Program,
  type ProgramIssues,
} from './programs/program-compiling.ts';
export type { Dialect, Refusal } from './programs/program-dialect.ts';
export type {
  Deadline,
  Limit,
  Outputs,
  ProgramLimits,
  ProgramOptions,
  ProgramRun,
  Variables,
} from './programs/program-running.ts';
export type { ProgramIssue, ProgramSpan } from './programs/program-tree.ts';
export {
  liftedLimits,
  mostEvaluationDepth,
  programPool,
  workerStackMegabytes,
  type PoolOutcome,
  type PoolSettings,
  type ProgramPool,
  type ProgramRequest,
  type Stopped,
} from './program-pool/program-pool.ts';
