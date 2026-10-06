import { Context } from 'effect';

import type { RecordedReader, RunOutcomesReader, StreamReader, StreamWriter } from './stream-ports.ts';

export class Ledger extends Context.Service<Ledger, StreamReader & StreamWriter & RecordedReader & RunOutcomesReader>()(
  '@beonauto/operations/Ledger',
) {}
