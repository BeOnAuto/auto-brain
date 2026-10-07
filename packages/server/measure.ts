import { availableParallelism } from 'node:os';

import { expiriesOn } from './measure/expiries.ts';
import { measuredLedgers, type MeasuredLedger } from './measure/measured-ledgers.ts';

const postgresqlServer = process.env['LEDGER_MEASURE_POSTGRESQL_URL'] ?? '';

const requests = 10_000;

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function measuredInTurn(ledgers: readonly MeasuredLedger[]): Promise<void> {
  const [first, ...rest] = ledgers;
  if (first !== undefined) {
    try {
      await expiriesOn(first, requests, write);
      await expiriesOn(first, 0, write);
    } finally {
      await first.removeAll();
    }
    await measuredInTurn(rest);
  }
}

write(`Node ${process.version}, ${availableParallelism()} cores`);
await measuredInTurn(measuredLedgers(postgresqlServer));
