import { setTimeout } from 'node:timers/promises';

import { echo } from '@on.auto/definitions/testing';
import type { Outcome } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Schema } from 'effect';

import { makeWorkflowAdapter } from '../capability/workflow.ts';
import { testExpressionCheck } from './expression-checks.ts';
import { playbookOn, type Playbook } from './playbook.ts';
import { testHost } from './test-host.ts';
import { testPlaybookNames } from './test-sandbox.ts';

export interface WorkflowPlaybook extends Playbook {
  readonly host: Awaited<ReturnType<typeof testHost>>;
  readonly settled: (runId: string) => Promise<Outcome>;
  readonly close: () => Promise<void>;
}

const mostDurationMs = 2_592_000_000;

const StartedSchema = Schema.Struct({ output: Schema.Struct({ status: Schema.Literal('started') }) });

const isStarted = Schema.is(StartedSchema);

export async function workflowPlaybook(): Promise<WorkflowPlaybook> {
  const ledger = memoryLedger();
  const nested = playbookOn(ledger, [echo]);
  const host = await testHost(nested);
  const playbook = playbookOn(ledger, [
    makeWorkflowAdapter({
      runs: host,
      check: testExpressionCheck,
      mostDurationMs,
      longestCallMs: 660_000,
      names: testPlaybookNames,
    }),
    echo,
  ]);
  const settled = async (runId: string): Promise<Outcome> => {
    const outcome = await playbook.call(playbook.getRun, { run_id: runId });
    if (!isStarted(outcome)) {
      return outcome;
    }
    await setTimeout(10);
    return settled(runId);
  };
  return { ...playbook, host, settled, close: () => host.stop() };
}
