import type { Effect } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import type { Conflict } from '../outcome/conflict.ts';
import type { InvalidInput } from '../outcome/invalid-input.ts';
import type { DeclarableReason, Rejection } from '../outcome/rejection.ts';
import type { ProjectionAdvancer, ProjectionReader } from '../projections/keyed-projection.ts';
import type { InvalidCursor, RecordedPage, RecordedPageRequest, RecordedSelection } from '../reading/recorded-read.ts';
import type { RunOutcomeGroup, RunOutcomeSelection, RunOutcomeWindow } from '../run-outcomes/run-outcomes.ts';
import type { Decider, StreamState, TypedEvent } from './decider.ts';
import type { Lineage } from './message-lineage.ts';

export interface StreamReader {
  readonly load: <State, Command, Event extends TypedEvent, R extends DeclarableReason>(
    stream: string,
    decider: Decider<State, Command, Event, R>,
  ) => Effect.Effect<StreamState<State>>;
}

export interface StreamWriter {
  readonly execute: <State, Command, Event extends TypedEvent, R extends DeclarableReason>(
    stream: string,
    decider: Decider<State, Command, Event, R>,
    command: Command,
    lineage?: Lineage,
  ) => Effect.Effect<StreamState<State>, Rejection<R> | Conflict>;
}

export interface RecordedReader {
  readonly readRecorded: (
    playbook: PlaybookAddress,
    selection: RecordedSelection,
    page: RecordedPageRequest,
  ) => Effect.Effect<RecordedPage, InvalidCursor>;
}

export interface PlaybookRecordedReader {
  readonly readRecorded: (
    selection: RecordedSelection,
    page: RecordedPageRequest,
  ) => Effect.Effect<RecordedPage, InvalidInput>;
}

export interface RunOutcomesReader {
  readonly readRunOutcomes: (
    playbook: PlaybookAddress,
    window: RunOutcomeWindow,
    selection: RunOutcomeSelection,
  ) => Effect.Effect<readonly RunOutcomeGroup[]>;
}

export type LedgerPorts = StreamReader &
  StreamWriter &
  RecordedReader &
  RunOutcomesReader &
  ProjectionReader &
  ProjectionAdvancer;

export interface PlaybookRunOutcomesReader {
  readonly readRunOutcomes: (
    window: RunOutcomeWindow,
    selection: RunOutcomeSelection,
  ) => Effect.Effect<readonly RunOutcomeGroup[]>;
}
