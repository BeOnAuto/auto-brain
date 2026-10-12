import {
  PlaybookContext,
  PlaybookReader,
  PlaybookWriter,
  messageIdOf,
  randomUUIDv7,
  streamPrefixOfPlaybook,
  type Lineage,
} from '@on.auto/operations';
import { Effect } from 'effect';

import type { RunFinish, RunStart } from '../runs/run-commands.ts';
import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import { startedRunOf, type RunState, type RunStreamState } from '../runs/run-state.ts';
import { commandMetadata } from './command-metadata.ts';

export const newRunId = Effect.sync(() => randomUUIDv7());

export function loadRunStream(id: string): Effect.Effect<RunStreamState, never, PlaybookReader> {
  return PlaybookReader.use((reader) => reader.load(runStreamNameOf(id), runDecider)).pipe(
    Effect.map(({ state }) => state),
  );
}

export function loadRun(id: string): Effect.Effect<RunState, never, PlaybookReader> {
  return Effect.map(loadRunStream(id), startedRunOf);
}

export const recordRun = Effect.fnUntraced(function* (id: string, command: RunStart | RunFinish, lineage: Lineage) {
  const metadata = yield* commandMetadata;
  const { state, version } = yield* (yield* PlaybookWriter).execute(
    runStreamNameOf(id),
    runDecider,
    { ...command, ...metadata, runId: id },
    lineage,
  );
  return {
    state: startedRunOf(state),
    messageId: messageIdOf(`${streamPrefixOfPlaybook(yield* PlaybookContext)}${runStreamNameOf(id)}`, version),
  };
});
