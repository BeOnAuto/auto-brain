import type { AppRuntime } from '@beonauto/api';
import type { RequestLedger } from '@beonauto/interaction';
import { Ledger, type DispatcherServices, type ProjectionReader } from '@beonauto/operations';
import { Effect } from 'effect';

import { inRuntime } from '../workflows/in-runtime.ts';

interface RuntimeLedger extends RequestLedger, Pick<ProjectionReader, 'countProjectedRows'> {}

export function runtimeLedger(runtime: AppRuntime<DispatcherServices>): RuntimeLedger {
  const viaLedger = <A, E>(use: (ledger: Ledger['Service']) => Effect.Effect<A, E>): Effect.Effect<A, E> =>
    inRuntime(runtime, Effect.flatMap(Effect.service(Ledger), use));
  return {
    load: (stream, decider) => viaLedger((ledger) => ledger.load(stream, decider)),
    execute: (stream, decider, command, lineage) =>
      viaLedger((ledger) => ledger.execute(stream, decider, command, lineage)),
    readRecorded: (brain, selection, page) => viaLedger((ledger) => ledger.readRecorded(brain, selection, page)),
    countProjectedRows: (projection, brain, where) =>
      viaLedger((ledger) => ledger.countProjectedRows(projection, brain, where)),
    readDueRows: (projection, query) => viaLedger((ledger) => ledger.readDueRows(projection, query)),
    nextDueOf: (projection, column, after) => viaLedger((ledger) => ledger.nextDueOf(projection, column, after)),
  };
}
