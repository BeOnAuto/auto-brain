import type { Effect } from 'effect';

import type { BrainAddress } from '../caller/brain-context.ts';
import type { Conflict } from '../outcome/conflict.ts';
import type { InvalidInput } from '../outcome/invalid-input.ts';
import type { DeclarableReason, Rejection } from '../outcome/rejection.ts';
import type {
  InvalidCursor,
  RecordedFact,
  RecordedPage,
  RecordedPageRequest,
  RecordedSelection,
} from '../reading/recorded-read.ts';
import type { RunOutcomeGroup, RunOutcomeSelection, RunOutcomeWindow } from '../run-outcomes/run-outcomes.ts';
import type { Decider, Fold, Recorded, StreamState } from './decider.ts';
import type { Lineage } from './message-lineage.ts';

export interface StreamReader {
  readonly load: <State, Event extends Recorded>(
    stream: string,
    fold: Fold<State, Event>,
  ) => Effect.Effect<StreamState<State>>;
}

export interface StreamWriter {
  readonly execute: <State, Command, Event extends Recorded, R extends DeclarableReason>(
    stream: string,
    decider: Decider<State, Command, Event, R>,
    command: Command,
    lineage?: Lineage,
  ) => Effect.Effect<StreamState<State>, Rejection<R> | Conflict>;
}

export interface RecordedReader {
  readonly readRecorded: (
    brain: BrainAddress,
    selection: RecordedSelection,
    page: RecordedPageRequest,
  ) => Effect.Effect<RecordedPage, InvalidCursor>;
  readonly readRecordedEvent: (brain: BrainAddress, id: string) => Effect.Effect<RecordedFact | undefined>;
}

export interface BrainRecordedReader {
  readonly readRecorded: (
    selection: RecordedSelection,
    page: RecordedPageRequest,
  ) => Effect.Effect<RecordedPage, InvalidInput>;
  readonly readRecordedEvent: (id: string) => Effect.Effect<RecordedFact | undefined>;
}

export interface RunOutcomesReader {
  readonly readRunOutcomes: (
    brain: BrainAddress,
    window: RunOutcomeWindow,
    selection: RunOutcomeSelection,
  ) => Effect.Effect<readonly RunOutcomeGroup[]>;
}

export interface BrainRunOutcomesReader {
  readonly readRunOutcomes: (
    window: RunOutcomeWindow,
    selection: RunOutcomeSelection,
  ) => Effect.Effect<readonly RunOutcomeGroup[]>;
}
