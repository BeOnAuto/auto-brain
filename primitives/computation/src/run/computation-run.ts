import type { InvalidInput } from '@beonauto/operations';
import type { Executed, PrimitiveRejection } from '@beonauto/specs';
import { checkedWorker } from '@beonauto/specs/json-schema';
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

function checkedBy({ output }: ComputationFunctionDefinitionDocument): Pick<ProgramRequest, 'worker' | 'context'> {
  return { worker: checkedWorker, context: output.schema?.document ?? null };
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
            endingOf(outcome, {
              document,
              inputBytes: jsonBytesOf(admitted),
              workers: pool.workers,
              heapMegabytes: pool.heapMegabytes,
              deadlineMs,
            }),
          ),
        ),
      ),
    );
}
