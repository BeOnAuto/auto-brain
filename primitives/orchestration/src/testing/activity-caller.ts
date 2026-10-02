import { Client, Connection, type WorkflowClient } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';

import { probeWorkflowsPath } from '../../replay-corpus.ts';
import type { executeSpecOn, executeSpecTwiceOn } from '../../temporal-probe-workflows.ts';
import type { SpecCall, SpecCallResult } from '../interpreter/host.ts';

export interface ActivityTarget {
  readonly address: string;
  readonly taskQueue: string;
  readonly workflowId: string;
}

interface Probe {
  readonly queue: string;
  readonly workflows: WorkflowClient;
  readonly worker: () => Promise<Worker>;
  readonly close: () => Promise<void>;
}

async function openProbe({ address, taskQueue }: ActivityTarget): Promise<Probe> {
  const queue = `${taskQueue}-probe`;
  const native = await NativeConnection.connect({ address });
  const connection = await Connection.connect({ address });
  return {
    queue,
    workflows: new Client({ connection }).workflow,
    worker: () => Worker.create({ connection: native, taskQueue: queue, workflowsPath: probeWorkflowsPath }),
    close: async () => {
      await connection.close();
      await native.close();
    },
  };
}

export async function executeSpecThroughActivity(target: ActivityTarget, call: SpecCall): Promise<SpecCallResult> {
  const probe = await openProbe(target);
  try {
    const worker = await probe.worker();
    return await worker.runUntil(
      probe.workflows.execute<typeof executeSpecOn>('executeSpecOn', {
        taskQueue: probe.queue,
        workflowId: target.workflowId,
        args: [target.taskQueue, call],
      }),
    );
  } finally {
    await probe.close();
  }
}

export async function executeSpecTwiceThroughActivity(
  target: ActivityTarget,
  call: SpecCall,
): Promise<readonly SpecCallResult[]> {
  const probe = await openProbe(target);
  try {
    const worker = await probe.worker();
    return await worker.runUntil(
      probe.workflows.execute<typeof executeSpecTwiceOn>('executeSpecTwiceOn', {
        taskQueue: probe.queue,
        workflowId: target.workflowId,
        args: [target.taskQueue, call],
      }),
    );
  } finally {
    await probe.close();
  }
}
