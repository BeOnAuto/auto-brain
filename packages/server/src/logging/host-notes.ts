import type { HostNote } from '@beonauto/workflow-host';
import { Effect } from 'effect';

type NoteOf<Kind extends HostNote['kind']> = Extract<HostNote, { readonly kind: Kind }>;

function standingBy({ holder, until }: NoteOf<'standing_by'>): Effect.Effect<void> {
  return Effect.logWarning(
    'The workflows of this database run in another server; this server serves everything else, and takes the workflows over if that server stops renewing its claim',
  ).pipe(Effect.annotateLogs({ holder, claimed_until: new Date(until).toISOString() }));
}

function tookOver({ holder }: NoteOf<'took_over'>): Effect.Effect<void> {
  return Effect.logWarning(
    'This server took over the workflows of its database, since the server that ran them stopped renewing its claim',
  ).pipe(Effect.annotateLogs({ holder }));
}

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
  if (note.kind === 'standing_by') {
    return standingBy(note);
  }
  if (note.kind === 'took_over') {
    return tookOver(note);
  }
  return note.kind === 'settle_backing_off' ? backingOff(note) : settledAfterBackingOff(note);
}
