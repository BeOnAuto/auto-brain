import { workerPool, type ProgramPoolOf } from './served-computation.ts';
import { projectionWiring, type ProjectionWiring } from './served-projections.ts';
import type { ModelAccessOf } from './served-reasoning.ts';
import type { TimedTools } from './served-tools.ts';

export interface FunctionWiring extends TimedTools {
  readonly modelAccessOf: ModelAccessOf;
  readonly programPoolOf: ProgramPoolOf;
  readonly projections: ProjectionWiring;
}

export function functionWiringOf(
  modelAccessOf: ModelAccessOf,
  programPoolOf: ProgramPoolOf = workerPool,
  toolTiming?: FunctionWiring['toolTiming'],
): FunctionWiring {
  return {
    modelAccessOf,
    programPoolOf,
    projections: projectionWiring(),
    ...(toolTiming === undefined ? {} : { toolTiming }),
  };
}
