import type { BrainRequest } from '@beonauto/operations';
import { Effect } from 'effect';

import { executionSettler, type ExecutionAddress, type Settlement } from '../index.ts';
import { acmeAdmin } from './callers.ts';
import { harness, toBrain } from './harness.ts';
import { probe } from './probe.ts';
import { relay } from './relay.ts';
import { specOperationsFor } from './spec-operations.ts';

export const relayedId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const settledAt = '2026-10-01T11:00:00.000Z';

const toAlpha = toBrain('acme', 'alpha');

const relayed: ExecutionAddress = { org: 'acme', brain: 'alpha', id: relayedId };

function handingOn(input: unknown): BrainRequest {
  return toAlpha(acmeAdmin, { primitive: 'relay', name: 'hand-on', input, execution_id: relayedId });
}

export async function withHandOn() {
  const relayer = relay();
  const operations = specOperationsFor([relayer.primitive, probe().primitive]);
  const specs = harness();
  await specs.call(operations.createSpec, toAlpha(acmeAdmin, { primitive: 'relay', name: 'hand-on', source: 'text' }));
  await specs.call(operations.createSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', source: 'text' }));
  const settle = executionSettler(specs.ledger.service);
  return {
    ...specs,
    ...operations,
    relayer,
    executing: (input: unknown = {}) => specs.call(operations.executeSpec, handingOn(input)),
    executingWithin: (milliseconds: number, input: unknown) =>
      specs.callWithin(milliseconds, operations.executeSpec, handingOn(input)),
    reading: () => specs.call(operations.getExecution, toAlpha(acmeAdmin, { execution_id: relayedId })),
    settling: (settlement: Settlement, address: ExecutionAddress = relayed) =>
      specs.run(Effect.result(settle(address, settlement)), settledAt),
    breakingDown: (settlement: Settlement) =>
      specs.run(
        Effect.catchDefect(Effect.result(settle(relayed, settlement)), (defect) => Effect.succeed(defect)),
        settledAt,
      ),
  };
}
