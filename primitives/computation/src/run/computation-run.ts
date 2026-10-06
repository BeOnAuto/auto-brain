import type { InvalidInput } from '@beonauto/operations';
import type { Executed, PrimitiveRejection } from '@beonauto/specs';
import { jsonBytesOf, type ProgramPool, type ProgramRequest } from '@beonauto/workflow-engine/dsl';
import { Effect, type Schema } from 'effect';

import type { ComputationFunctionDefinitionDocument } from '../document/computation-document.ts';
import { computationDialect } from '../document/program-dialect.ts';
import { computationLimits, mostOutputBytes } from './run-bounds.ts';
import { preparedInput } from './run-input.ts';
import { endingOf } from './run-outcome.ts';

export interface ComputationRunOptions {
  readonly pool: ProgramPool;
  readonly deadlineMs: number;
}

export type ComputationRun = (
  document: ComputationFunctionDefinitionDocument,
  input: Schema.Json,
) => Effect.Effect<Executed, PrimitiveRejection>;

const outputWorker = new URL('./output-worker.ts', import.meta.url);

function checkedBy({ output }: ComputationFunctionDefinitionDocument): Pick<ProgramRequest, 'worker' | 'context'> {
  return output.schema === undefined ? {} : { worker: outputWorker, context: output.schema.document };
}

export function computationRun({ pool, deadlineMs }: ComputationRunOptions): ComputationRun {
  return (document, input) =>
    preparedInput(input, document.input).pipe(
      Effect.flatMap((admitted): Effect.Effect<Executed, PrimitiveRejection | InvalidInput> =>
        Effect.promise((signal) =>
          pool.run(
            {
              source: document.program,
              input: admitted,
              dialect: computationDialect,
              limits: computationLimits,
              deadlineMs,
              mostOutputBytes,
              ...checkedBy(document),
            },
            signal,
          ),
        ).pipe(
          Effect.flatMap((outcome) =>
            endingOf(outcome, { document, inputBytes: jsonBytesOf(admitted), workers: pool.workers, deadlineMs }),
          ),
        ),
      ),
    );
}
