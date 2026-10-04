import { BrainReader, BrainWriter, randomUUIDv7 } from '@beonauto/operations';
import { Effect } from 'effect';

import type { ExecutionFinish, ExecutionStart } from '../execution/execution-commands.ts';
import { executionDecider, executionStreamOf } from '../execution/execution-decider.ts';
import type { ExecutionState } from '../execution/execution-state.ts';
import { commandMetadata } from './command-metadata.ts';

export const newExecutionId = Effect.sync(() => randomUUIDv7());

export function loadExecution(id: string): Effect.Effect<ExecutionState, never, BrainReader> {
  return BrainReader.use((reader) => reader.load(executionStreamOf(id), executionDecider)).pipe(
    Effect.map(({ state }) => state),
  );
}

export const recordExecution = Effect.fnUntraced(function* (id: string, command: ExecutionStart | ExecutionFinish) {
  const metadata = yield* commandMetadata;
  const { state } = yield* (yield* BrainWriter).execute(executionStreamOf(id), executionDecider, {
    ...command,
    ...metadata,
  });
  return state;
});
