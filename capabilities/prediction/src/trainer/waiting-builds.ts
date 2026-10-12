import { recordedRunInPlaybook } from '@on.auto/definitions';
import { Conflict, PlaybookContext, PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { buildRecordOf, buildStateOf, type BuildRecord, type BuildState } from '../builds/build-state.ts';
import { childIdOf, requestReference } from '../builds/child-runs.ts';

export interface WaitingBuild {
  readonly build: BuildState;
  readonly record: BuildRecord;
}

function notABuild(id: string): Conflict {
  return new Conflict({ detail: `Run ${id} is not a build`, kind: 'not_a_build' });
}

const buildEnded = new Conflict({ detail: 'The build has ended', kind: 'build_ended' });

function childHasEnded(id: string): Effect.Effect<boolean, never, PlaybookReader> {
  return Effect.flatMap(PlaybookReader, (reader) =>
    Effect.map(recordedRunInPlaybook(reader, childIdOf(id, requestReference)), (child) =>
      child === undefined ? false : child.run.status !== 'started',
    ),
  );
}

export function waitingBuildOf(id: string): Effect.Effect<WaitingBuild, Conflict, PlaybookReader | PlaybookContext> {
  return Effect.gen(function* () {
    const { org, playbook } = yield* PlaybookContext;
    const reader = yield* PlaybookReader;
    const build = buildStateOf({ org, playbook, id }, yield* recordedRunInPlaybook(reader, id));
    if (build === undefined) {
      return yield* notABuild(id);
    }
    const record = buildRecordOf(build.run);
    if (record === undefined || !build.run.awaitsSettlement || build.run.answer !== null) {
      return yield* buildEnded;
    }
    const childEnded = record.waiting_for !== undefined && (yield* childHasEnded(build.address.id));
    return childEnded ? yield* buildEnded : { build, record };
  });
}
