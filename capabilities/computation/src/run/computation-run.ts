import type { CapabilityAnswer, CapabilityRejection } from '@beonauto/definitions';
import { checkedWorker } from '@beonauto/definitions/json-schema';
import type { InvalidInput } from '@beonauto/operations';
import { jsonBytesOf, type ProgramPool, type ProgramRequest } from '@beonauto/workflow-engine/dsl';
import { Clock, Effect, type Schema } from 'effect';

import type { ComputationFunctionDefinitionDocument } from '../document/computation-document.ts';
import { computationBounds, mostOutputBytes } from './run-bounds.ts';
import { preparedInput } from './run-input.ts';
import { endingOf } from './run-outcome.ts';

export interface ComputationRunOptions {
  readonly pool: ProgramPool;
  readonly deadlineMs: number;
  readonly budget: number;
  readonly memoryBytes: number;
}

export type ComputationRun = (
  document: ComputationFunctionDefinitionDocument,
  input: Schema.Json,
) => Effect.Effect<CapabilityAnswer, CapabilityRejection>;

function checkedBy({ output }: ComputationFunctionDefinitionDocument): Pick<ProgramRequest, 'worker' | 'context'> {
  return { worker: checkedWorker, context: output.schema?.document ?? null };
}

function requestOf(
  document: ComputationFunctionDefinitionDocument,
  input: Schema.Json,
  moment: number,
  { deadlineMs, budget, memoryBytes }: Omit<ComputationRunOptions, 'pool'>,
): ProgramRequest {
  return {
    source: document.program,
    entry: 'default',
    arguments: [input],
    moment,
    budget,
    memoryBytes,
    stackBytes: computationBounds.stackBytes,
    deadlineMs,
    mostOutputBytes,
    ...checkedBy(document),
  };
}

export function computationRun({ pool, ...bounds }: ComputationRunOptions): ComputationRun {
  return (document, input) =>
    Effect.all([preparedInput(input, document.input), Clock.currentTimeMillis]).pipe(
      Effect.flatMap(
        ([admitted, moment]: readonly [Schema.Json, number]): Effect.Effect<
          CapabilityAnswer,
          CapabilityRejection | InvalidInput
        > =>
          Effect.promise((signal) => pool.run(requestOf(document, admitted, moment, bounds), signal)).pipe(
            Effect.flatMap((outcome) =>
              endingOf(outcome, {
                document,
                inputBytes: jsonBytesOf(admitted),
                workers: pool.workers,
                heapMegabytes: pool.heapMegabytes,
                ...bounds,
              }),
            ),
          ),
      ),
    );
}
