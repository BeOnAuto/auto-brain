import { NotFound } from '@beonauto/operations';
import type { Run, SettleExecution } from '@beonauto/specs';
import { Effect } from 'effect';

const settledExecution: Run = {
  execution_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  primitive: 'orchestration',
  name: 'flow',
  spec_version: 1,
  status: 'succeeded',
  output: 'done',
  started_at: '2026-10-01T09:00:00.000Z',
  started_by: 'acme-admin',
  finished_at: '2026-10-01T09:00:01.000Z',
};

export function knownExecutions(): { readonly settle: SettleExecution; readonly know: (id: string) => void } {
  const known = new Set<string>();
  return {
    settle: ({ id }) =>
      known.has(id)
        ? Effect.succeed(settledExecution)
        : Effect.fail(new NotFound({ detail: 'There is no such execution in this brain' })),
    know: (id) => {
      known.add(id);
    },
  };
}
