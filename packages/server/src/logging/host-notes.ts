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

function offerDeclined({ run, detail }: NoteOf<'offer_declined'>): Effect.Effect<void> {
  return Effect.logWarning(
    'A run waiting for an event of its brain did not take one, since its filter failed on the event',
  ).pipe(Effect.annotateLogs({ org: run.org, brain: run.brain, execution_id: run.executionId, error: detail }));
}

function recordUnreadable({ org, brain, recordId, type }: NoteOf<'record_unreadable'>): Effect.Effect<void> {
  return Effect.logWarning(
    'A record of the brain could not be read to match triggers and waiting runs against; it was passed over',
  ).pipe(Effect.annotateLogs({ org, brain, record_id: recordId, type }));
}

function runRecordPassed({ run, version, sweeps }: NoteOf<'run_record_passed'>): Effect.Effect<void> {
  return Effect.logWarning(
    `A record of a run's log was passed before the run's outputs were dispatched, after ${sweeps} sweeps held it; a listener it armed takes events once it is kept, and none recorded before`,
  ).pipe(Effect.annotateLogs({ org: run.org, brain: run.brain, execution_id: run.executionId, version }));
}

function logRunNote(
  note: NoteOf<'settle_backing_off' | 'settled_after_back_off' | 'offer_declined' | 'run_record_passed'>,
) {
  if (note.kind === 'offer_declined') {
    return offerDeclined(note);
  }
  if (note.kind === 'run_record_passed') {
    return runRecordPassed(note);
  }
  return note.kind === 'settle_backing_off' ? backingOff(note) : settledAfterBackingOff(note);
}

export function logHostNote(note: HostNote): Effect.Effect<void> {
  if (note.kind === 'standing_by') {
    return standingBy(note);
  }
  if (note.kind === 'took_over') {
    return tookOver(note);
  }
  return note.kind === 'record_unreadable' ? recordUnreadable(note) : logRunNote(note);
}
