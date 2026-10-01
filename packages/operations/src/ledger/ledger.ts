import { Context } from 'effect';

import type { StreamReader, StreamWriter } from './stream-ports.ts';

export class Ledger extends Context.Service<Ledger, StreamReader & StreamWriter>()('@beonauto/operations/Ledger') {}
