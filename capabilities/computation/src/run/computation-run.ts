import type { CapabilityAnswer, CapabilityRejection, StrippedForms } from '@beonauto/definitions';
import { checkedWorker } from '@beonauto/definitions/json-schema';
import { Conflict, type InvalidInput } from '@beonauto/operations';
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
  stripped: StrippedForms,
) => Effect.Effect<CapabilityAnswer, CapabilityRejection>;

interface Runnable {
  readonly document: ComputationFunctionDefinitionDocument;
  readonly program: string;
}

const notCompiled = new Conflict({
  detail:
    'The computation function was saved without the program its check strips for the sandbox; update it to save it again',
  kind: 'unworkable',
});

function checkedBy({ output }: ComputationFunctionDefinitionDocument): Pick<ProgramRequest, 'worker' | 'context'> {
  return { worker: checkedWorker, context: output.schema?.document ?? null };
}

function requestOf(
  { document, program }: Runnable,
  input: Schema.Json,
  moment: number,
  { deadlineMs, budget, memoryBytes }: Omit<ComputationRunOptions, 'pool'>,
): ProgramRequest {
  return {
    source: program,
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

function runnableOf(
  document: ComputationFunctionDefinitionDocument,
  { module }: StrippedForms,
): Effect.Effect<Runnable, Conflict> {
  return module === undefined ? Effect.fail(notCompiled) : Effect.succeed({ document, program: module });
}

export function computationRun({ pool, ...bounds }: ComputationRunOptions): ComputationRun {
  return (document, input, stripped) =>
    Effect.all([runnableOf(document, stripped), preparedInput(input, document.input), Clock.currentTimeMillis]).pipe(
      Effect.flatMap(
        ([runnable, admitted, moment]: readonly [Runnable, Schema.Json, number]): Effect.Effect<
          CapabilityAnswer,
          CapabilityRejection | InvalidInput
        > =>
          Effect.promise((signal) => pool.run(requestOf(runnable, admitted, moment, bounds), signal)).pipe(
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
