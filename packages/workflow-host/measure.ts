import { timerLatenessOn } from './measure/lateness.ts';
import { recoveryOn } from './measure/recovery.ts';
import { measuredStores, type MeasuredStore } from './measure/stores.ts';
import { throughputOn, type Throughput } from './measure/throughput.ts';

const postgresqlServer = process.env['LEDGER_MEASURE_POSTGRESQL_URL'] ?? '';

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function rateOf({ runs, inputs, milliseconds }: Throughput): string {
  const perSecond = Math.round((inputs * 1000) / milliseconds);
  return `${inputs} inputs of ${runs} runs in ${(milliseconds / 1000).toFixed(2)} s, ${perSecond} inputs a second`;
}

async function measuredOn({ store, aDatabase, removeAll }: MeasuredStore): Promise<void> {
  try {
    const lateness = await timerLatenessOn(await aDatabase(), 1000);
    write(
      `${store}: ${lateness.timers} timers fired late by ${lateness.p50} ms at the median, ${lateness.p99} ms at p99, ${lateness.most} ms at most`,
    );
    write(`${store}: the long-run loop, ${rateOf(await throughputOn(await aDatabase(), 1, 3000))}`);
    write(`${store}: runs side by side, ${rateOf(await throughputOn(await aDatabase(), 100, 100))}`);
    const recovery = await recoveryOn(await aDatabase());
    write(
      `${store}: after a restart, a snapshot of ${recovery.snapshotBytes} bytes and ${recovery.eventsAfterIt} events after it: the host opened in ${recovery.openMs.toFixed(1)} ms, the first input took ${recovery.firstInputMs.toFixed(1)} ms and the next ${recovery.nextInputMs.toFixed(1)} ms`,
    );
  } finally {
    await removeAll();
  }
}

async function measuredInTurn(stores: readonly MeasuredStore[]): Promise<void> {
  const [first, ...rest] = stores;
  if (first !== undefined) {
    await measuredOn(first);
    await measuredInTurn(rest);
  }
}

write(`Node ${process.version}`);
await measuredInTurn(measuredStores(postgresqlServer));
