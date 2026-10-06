import { timerLatenessOn } from './measure/lateness.ts';
import { reactionLatencyOn, type ReactionLatency } from './measure/reactions.ts';
import { recoveryOn } from './measure/recovery.ts';
import { measuredStores, type MeasuredStore } from './measure/stores.ts';
import { sweepCostOn } from './measure/sweeps.ts';
import { throughputOn, type Throughput } from './measure/throughput.ts';

const postgresqlServer = process.env['LEDGER_MEASURE_POSTGRESQL_URL'] ?? '';

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function rateOf({ runs, inputs, milliseconds }: Throughput): string {
  const perSecond = Math.round((inputs * 1000) / milliseconds);
  return `${inputs} inputs of ${runs} runs in ${(milliseconds / 1000).toFixed(2)} s, ${perSecond} inputs a second`;
}

const reacted = { workflows: 100, events: 1000 };

function latencyLine(store: string, signal: string, latency: ReactionLatency): string {
  return `${store}: ${latency.events} events, each matching one of ${latency.workflows} workflows, ${signal} the append signal, started their runs ${latency.p50} ms after their append at the median, ${latency.p99} ms at p99, ${latency.most} ms at most`;
}

async function measuredOn({ store, aDatabase, removeAll }: MeasuredStore): Promise<void> {
  try {
    const lateness = await timerLatenessOn(await aDatabase(), 1000);
    write(
      `${store}: ${lateness.timers} timers fired late by ${lateness.p50} ms at the median, ${lateness.p99} ms at p99, ${lateness.most} ms at most`,
    );
    write(`${store}: the long-run loop, ${rateOf(await throughputOn(await aDatabase(), 1, 3000))}`);
    write(`${store}: runs side by side, ${rateOf(await throughputOn(await aDatabase(), 100, 100))}`);
    const reacting = await timerLatenessOn(await aDatabase(), 1000, 1000);
    write(
      `${store}: with 1000 workflows with event triggers in the brain, ${reacting.timers} timers fired late by ${reacting.p50} ms at the median, ${reacting.p99} ms at p99, ${reacting.most} ms at most`,
    );
    write(latencyLine(store, 'with', await reactionLatencyOn(await aDatabase(), { ...reacted, signalled: true })));
    write(latencyLine(store, 'without', await reactionLatencyOn(await aDatabase(), { ...reacted, signalled: false })));
    const sweep = await sweepCostOn(await aDatabase(), 1000, 10);
    write(
      `${store}: a pass over each of ${sweep.brains} brains, ${sweep.reacting} with an event trigger, took ${sweep.firstMs.toFixed(0)} ms reading one new record in each, and ${sweep.steadyMs.toFixed(0)} ms with nothing new`,
    );
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
