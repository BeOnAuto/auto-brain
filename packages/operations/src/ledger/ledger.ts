import { Context } from 'effect';

import type { RecordedContent } from '../content/recorded-content.ts';
import type { ProjectionAdvancer, ProjectionReader } from '../projections/keyed-projection.ts';
import type { RecordedReader, RunOutcomesReader, StreamReader, StreamWriter } from './stream-ports.ts';

export interface ContentKeeper {
  readonly content: RecordedContent;
}

export type LedgerPorts = StreamReader &
  StreamWriter &
  RecordedReader &
  RunOutcomesReader &
  ProjectionReader &
  ProjectionAdvancer &
  ContentKeeper;

export class Ledger extends Context.Service<Ledger, LedgerPorts>()('@beonauto/operations/Ledger') {}
