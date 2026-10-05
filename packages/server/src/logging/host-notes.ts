import type { HostNote } from '@beonauto/workflow-host';
import { Effect } from 'effect';

type NoteOf<Kind extends HostNote['kind']> = Extract<HostNote, { readonly kind: Kind }>;

function backingOff({ run, attempts, detail }: NoteOf<'settle_backing_off'>): Effect.Effect<void> {
  return Effect.logWarning(
    `An execution could not be settled in ${attempts} attempts; it is tried again once a minute until it is`,
  ).pipe(Effect.annotateLogs({ org: run.org, brain: run.brain, execution_id: run.executionId, error: detail }));
}

function settledAfterBackingOff({ run, attempts }: NoteOf<'settled_after_back_off'>): Effect.Effect<void> {
  return Effect.logWarning(`An execution that could not be settled was settled at attempt ${attempts}`).pipe(
    Effect.annotateLogs({ org: run.org, brain: run.brain, execution_id: run.executionId }),
  );
}

export function logHostNote(note: HostNote): Effect.Effect<void> {
  return note.kind === 'settle_backing_off' ? backingOff(note) : settledAfterBackingOff(note);
}
