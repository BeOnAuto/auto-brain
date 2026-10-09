import type { BrainRequest, Lineage } from '@beonauto/operations';
import { Effect } from 'effect';

import { runSettler, type RunStreamAddress, type Settlement } from '../index.ts';
import { acmeAdmin } from './callers.ts';
import { definitionOperationsFor } from './definition-operations.ts';
import { harness, toBrain } from './harness.ts';
import { probe } from './probe.ts';
import { relay } from './relay.ts';

export const relayedId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const settledAt = '2026-10-01T11:00:00.000Z';

export const cancelledAt = '2026-10-01T10:00:00.000Z';

const toAlpha = toBrain('acme', 'alpha');

const relayed: RunStreamAddress = { org: 'acme', brain: 'alpha', id: relayedId };

function handingOn(input: unknown): BrainRequest {
  return toAlpha(acmeAdmin, { type: 'relay', name: 'hand-on', input, run_id: relayedId });
}

export async function withHandOn() {
  const relayer = relay();
  const prober = probe();
  const operations = definitionOperationsFor([relayer.capability, prober.capability]);
  const definitions = harness();
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'relay', name: 'hand-on', source: 'text' }),
  );
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'text' }),
  );
  const settle = runSettler(definitions.ledger.service);
  return {
    ...definitions,
    ...operations,
    relayer,
    prober,
    running: (input: unknown = {}) => definitions.call(operations.runDefinition, handingOn(input)),
    executingCancelledOnceStarted: (input: unknown) =>
      definitions.callCancelledWhen(relayer.started, operations.runDefinition, handingOn(input)),
    reading: () => definitions.call(operations.getRun, toAlpha(acmeAdmin, { run_id: relayedId })),
    cancelling: (input: object = {}, id: string = relayedId) =>
      definitions.call(operations.cancelRun, toAlpha(acmeAdmin, { run_id: id, ...input }), cancelledAt),
    history: () => definitions.call(operations.getRunHistory, toAlpha(acmeAdmin, { run_id: relayedId, limit: 100 })),
    settling: (settlement: Settlement, address: RunStreamAddress = relayed, lineage?: Lineage) =>
      definitions.run(Effect.result(settle(address, settlement, lineage)), settledAt),
    breakingDown: (settlement: Settlement) =>
      definitions.run(
        Effect.catchDefect(Effect.result(settle(relayed, settlement)), (defect) => Effect.succeed(defect)),
        settledAt,
      ),
  };
}
