import { availableParallelism } from 'node:os';

import { expiriesOn } from './measure/expiries.ts';
import { hangingOn } from './measure/hanging.ts';
import { measuredLedgers, type MeasuredLedger } from './measure/measured-ledgers.ts';

const postgresqlServer = process.env['LEDGER_MEASURE_POSTGRESQL_URL'] ?? '';

const only = process.env['MEASURE_ONLY'] ?? '';

const requests = 10_000;

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function measuredOn(ledger: MeasuredLedger): Promise<void> {
  if (only !== 'hanging') {
    await expiriesOn(ledger, requests, write);
    await expiriesOn(ledger, 0, write);
  }
  if (only !== 'expiries') {
    await hangingOn(ledger, 32, write);
    await hangingOn(ledger, 256, write);
  }
}

async function measuredInTurn(ledgers: readonly MeasuredLedger[]): Promise<void> {
  const [first, ...rest] = ledgers;
  if (first !== undefined) {
    try {
      await measuredOn(first);
    } finally {
      await first.removeAll();
    }
    await measuredInTurn(rest);
  }
}

write(`Node ${process.version}, ${availableParallelism()} cores`);
await measuredInTurn(measuredLedgers(postgresqlServer));
