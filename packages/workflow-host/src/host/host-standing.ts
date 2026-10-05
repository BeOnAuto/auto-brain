import { randomUUID } from 'node:crypto';

import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { hostLease, leaseMsFor } from '../lease/host-lease.ts';
import { keptLease } from '../lease/lease-keeper.ts';
import type { HostEngine } from './host-engine.ts';
import { startServing, type Serving, type ServingOptions } from './host-serving.ts';

export interface Standing {
  readonly serving: () => HostEngine | undefined;
  readonly stop: () => Promise<void>;
}

export async function standingOn(
  database: HostDatabase,
  options: ServingOptions,
  holder: string = randomUUID(),
): Promise<Standing> {
  const { reports, sweepEveryMs, clock } = options;
  const lastsMs = leaseMsFor(sweepEveryMs);
  const lease = hostLease(database, holder, lastsMs);
  const current: { serving: Serving | null } = { serving: null };
  const servedNoMore = Effect.promise(async () => {
    const { serving } = current;
    current.serving = null;
    await serving?.stop();
  });
  const keeper = await keptLease({
    lease,
    clock,
    sweepEveryMs,
    lastsMs,
    held: (before) =>
      Effect.andThen(
        Effect.sync(() => {
          current.serving = startServing(database, options);
        }),
        before === 'standing_by' ? reports.note({ kind: 'took_over', holder }) : Effect.void,
      ),
    standingBy: ({ holder: elsewhere, until }) =>
      Effect.andThen(servedNoMore, reports.note({ kind: 'standing_by', holder: elsewhere, until })),
    trouble: reports.trouble,
  });
  return {
    serving: () => current.serving?.engine,
    stop: async () => {
      await keeper.stop();
      await Effect.runPromise(servedNoMore);
      await Effect.runPromise(Effect.ignore(lease.released()));
    },
  };
}
