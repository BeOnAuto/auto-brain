import {
  BrainContext,
  BrainReader,
  BrainWriter,
  messageIdOf,
  randomUUIDv7,
  streamPrefixOfBrain,
  type Lineage,
} from '@beonauto/operations';
import { Effect } from 'effect';

import type { ExecutionFinish, ExecutionStart } from '../execution/execution-commands.ts';
import { executionDecider, executionStreamOf } from '../execution/execution-decider.ts';
import { runOf, type ExecutionState, type ExecutionStreamState } from '../execution/execution-state.ts';
import { commandMetadata } from './command-metadata.ts';

export const newExecutionId = Effect.sync(() => randomUUIDv7());

export function loadExecutionStream(id: string): Effect.Effect<ExecutionStreamState, never, BrainReader> {
  return BrainReader.use((reader) => reader.load(executionStreamOf(id), executionDecider)).pipe(
    Effect.map(({ state }) => state),
  );
}

export function loadExecution(id: string): Effect.Effect<ExecutionState, never, BrainReader> {
  return Effect.map(loadExecutionStream(id), runOf);
}

export const recordExecution = Effect.fnUntraced(function* (
  id: string,
  command: ExecutionStart | ExecutionFinish,
  lineage: Lineage,
) {
  const metadata = yield* commandMetadata;
  const { state, version } = yield* (yield* BrainWriter).execute(
    executionStreamOf(id),
    executionDecider,
    { ...command, ...metadata },
    lineage,
  );
  return {
    state: runOf(state),
    messageId: messageIdOf(`${streamPrefixOfBrain(yield* BrainContext)}${executionStreamOf(id)}`, version),
  };
});
