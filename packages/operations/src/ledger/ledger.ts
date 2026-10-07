import { Context } from 'effect';

import type { LedgerPorts } from './stream-ports.ts';

export class Ledger extends Context.Service<Ledger, LedgerPorts>()('@beonauto/operations/Ledger') {}
