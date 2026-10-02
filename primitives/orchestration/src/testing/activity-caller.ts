import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';

import { probeWorkflowsPath } from '../../replay-corpus.ts';
import type { executeSpecOn } from '../../temporal-probe-workflows.ts';
import type { SpecCall, SpecCallResult } from '../interpreter/host.ts';

export interface ActivityTarget {
  readonly address: string;
  readonly taskQueue: string;
  readonly workflowId: string;
}

export async function executeSpecThroughActivity(
  { address, taskQueue, workflowId }: ActivityTarget,
  call: SpecCall,
): Promise<SpecCallResult> {
  const probeQueue = `${taskQueue}-probe`;
  const native = await NativeConnection.connect({ address });
  const connection = await Connection.connect({ address });
  try {
    const worker = await Worker.create({
      connection: native,
      taskQueue: probeQueue,
      workflowsPath: probeWorkflowsPath,
    });
    const workflows = new Client({ connection }).workflow;
    return await worker.runUntil(
      workflows.execute<typeof executeSpecOn>('executeSpecOn', {
        taskQueue: probeQueue,
        workflowId,
        args: [taskQueue, call],
      }),
    );
  } finally {
    await connection.close();
    await native.close();
  }
}
