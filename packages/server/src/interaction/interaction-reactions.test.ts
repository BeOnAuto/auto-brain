import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { servingInteractions } from '../testing/servers/interaction-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/servers/workflow-calls.ts';
import { workflowSource, workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

const decodeRuns = Schema.decodeUnknownSync(
  Schema.Struct({
    executions: Schema.Array(Schema.Struct({ execution_id: Schema.String, status: Schema.String })),
  }),
);

const onAnApproval = workflowSource(
  'on-approval',
  `schedule:
  on: { one: { with: { type: execution_succeeded, subject: interaction/approve-brief } } }
do:
  - noted: { set: { choice: '\${ .[0].data.output.choice }', answered_by: '\${ .[0].data.caller }' } }
`,
);

const hurried = `do:
  - ask:
      call: execute_spec
      with: { primitive: interaction, name: approve-brief, input: { campaign: Spring, owner: ada } }
      timeout: { after: { milliseconds: 500 } }
`;

describe('another workflow, triggered by the answer to a request', { timeout: workflowTestTimeoutMs }, () => {
  it('starts on the ending of the interaction function and reads the answer and who gave it', async () => {
    const server = await servingInteractions('inbox');
    await server.call('POST', `${alpha}/specs/orchestration`, { body: { name: 'on-approval', source: onAnApproval } });
    const runId = await server.ask('approve-brief');

    await server.answer(runId, { answer: { choice: 'approve' } });
    const [reaction] = await until(
      async () =>
        decodeRuns((await server.call('GET', `${alpha}/executions?primitive=orchestration&name=on-approval`)).body)
          .executions,
      (runs) => runs.some(({ status }) => status !== 'started'),
    );

    expect(await server.settled(String(reaction?.execution_id))).toMatchObject({
      status: 'succeeded',
      output: { choice: 'approve', answered_by: 'local' },
    });
  });
});

describe('a request a workflow step waits for past its deadline', { timeout: workflowTestTimeoutMs }, () => {
  it('is cancelled with the kind deadline, and leaves the inbox', async () => {
    const server = await servingInteractions('inbox');
    const workflowId = await server.workflow('hurried', hurried);

    const [request] = await server.openRequests(1);
    const workflow = await server.settled(workflowId);
    const asked = await server.settled(String(request));

    expect(workflow).toMatchObject({ status: 'rejected', rejection: { reason: 'unavailable' } });
    expect(asked).toMatchObject({ status: 'rejected', rejection: { reason: 'cancelled', kind: 'deadline' } });
    expect(await server.openRequests(0)).toEqual([]);
  });
});
