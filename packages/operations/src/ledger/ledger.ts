import { Context } from 'effect';

import type { RecordedReader, StreamReader, StreamWriter } from './stream-ports.ts';

export class Ledger extends Context.Service<Ledger, StreamReader & StreamWriter & RecordedReader>()(
  '@beonauto/operations/Ledger',
) {}
