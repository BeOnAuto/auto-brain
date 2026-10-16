import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

const seatHold = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema:',
  '    type: object',
  '    required: [seats]',
  '    properties:',
  "      seats: { type: integer, minimum: 1, description: 'How many seats to hold' }",
  '---',
  'Hold {{ input.seats }} seats.',
].join('\n');

const holdingSeats = workflowSource(
  'holding-seats',
  `do:
  - count-seats:
      call: run_definition
      with: { type: reasoning, name: seat-hold, input: '\${ $input }' }
`,
);

const refusedSeats = { pointer: '/input/seats', detail: 'seats, how many seats to hold: expected at least 1.' };

const refusedAtTheStep =
  'seats, how many seats to hold: expected at least 1, at the step count-seats. The reasoning function seat-hold rejected the run with invalid_input.';

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function servingTheHold(): Promise<void> {
  server = await servingWorkflows([]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'seat-hold', source: seatHold } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'holding-seats', source: holdingSeats } });
}

describe('a workflow whose first step refuses a field of its input, over HTTP', () => {
  it('is rejected in the words of the field, with the issues of the step at their pointers', async () => {
    await servingTheHold();
    const started = await server.call('POST', `${alpha}/definitions/workflow/holding-seats/run`, {
      body: { input: { seats: 0 } },
    });
    const runId = runIdIn(started.body);

    expect(await settledRun(server, `${alpha}/runs/${runId}`)).toMatchObject({
      body: {
        status: 'rejected',
        rejection: { reason: 'invalid_input', detail: refusedAtTheStep, issues: [refusedSeats] },
      },
    });
    expect(
      await server.call('POST', `${alpha}/definitions/workflow/holding-seats/run`, {
        body: { input: { seats: 0 }, run_id: runId },
      }),
    ).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', detail: refusedAtTheStep, errors: [refusedSeats] },
    });
  });
});
