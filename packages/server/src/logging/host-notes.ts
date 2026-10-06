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

function passedOver({ brain, record }: NoteOf<'record_passed_over'>): Effect.Effect<void> {
  return Effect.logWarning(
    'A recorded event of a brain could not be read as an event, so no recall function folds it',
  ).pipe(Effect.annotateLogs({ brain, record }));
}

function viewStalled({ brain, name, version }: NoteOf<'view_stalled'>): Effect.Effect<void> {
  return Effect.logWarning(
    'The view of a recall function stopped at an event its fold could not take; saving a corrected version rebuilds it',
  ).pipe(Effect.annotateLogs({ brain, recall_function: name, version }));
}

const loggers: { readonly [Kind in HostNote['kind']]: (note: NoteOf<Kind>) => Effect.Effect<void> } = {
  standing_by: standingBy,
  took_over: tookOver,
  settle_backing_off: backingOff,
  settled_after_back_off: settledAfterBackingOff,
  record_passed_over: passedOver,
  view_stalled: viewStalled,
};

function loggedBy<Kind extends HostNote['kind']>(note: NoteOf<Kind>): Effect.Effect<void> {
  const logger: (note: NoteOf<Kind>) => Effect.Effect<void> = loggers[note.kind];
  return logger(note);
}

export function logHostNote(note: HostNote): Effect.Effect<void> {
  return loggedBy(note);
}
