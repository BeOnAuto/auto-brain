import { workerPool, type ProgramPoolOf } from './served-computation.ts';
import type { ModelAccessOf } from './served-reasoning.ts';
import { recallWiring, type RecallWiring } from './served-recall.ts';
import type { TimedTools } from './served-tools.ts';

export interface FunctionWiring extends TimedTools {
  readonly modelAccessOf: ModelAccessOf;
  readonly programPoolOf: ProgramPoolOf;
  readonly recall: RecallWiring;
}

export function functionWiringOf(
  modelAccessOf: ModelAccessOf,
  programPoolOf: ProgramPoolOf = workerPool,
  toolTiming?: FunctionWiring['toolTiming'],
): FunctionWiring {
  return { modelAccessOf, programPoolOf, recall: recallWiring(), ...(toolTiming === undefined ? {} : { toolTiming }) };
}
