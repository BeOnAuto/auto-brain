import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ExecutionCommand } from '../execution/execution-commands.ts';
import { executionDecider, executionStreamOf } from '../execution/execution-decider.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toBrain } from '../testing/harness.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';
import { startOfCall, toolUser } from '../testing/tool-user.ts';

const toAlpha = toBrain('acme', 'alpha');

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const at = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const typesOf = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }) }),
);

async function brainWithToolUser() {
  const user = toolUser();
  const operations = specOperationsFor([user.primitive]);
  const specs = harness();
  await specs.call(operations.createSpec, toAlpha(acmeAdmin, { primitive: 'tool-user', name: 'caller', source: 'x' }));
  const executing = (input: object) =>
    specs.call(
      operations.executeSpec,
      toAlpha(acmeAdmin, { primitive: 'tool-user', name: 'caller', input, execution_id: executionId }),
    );
  const history = async () =>
    typesOf(
      await specs.call(operations.getExecutionHistory, toAlpha(acmeAdmin, { execution_id: executionId, limit: 100 })),
    ).output.events.map(({ type }) => type);
  const recordedDirectly = (...commands: readonly ExecutionCommand[]) =>
    specs.run(
      Effect.forEach(commands, (command) =>
        Effect.orDie(
          specs.ledger.service.execute(`brain/acme/alpha/${executionStreamOf(executionId)}`, executionDecider, command),
        ),
      ),
    );
  return { ...specs, ...operations, user, executing, history, recordedDirectly };
}

const calls = (count: number, type: string): readonly string[] => Array.from({ length: count }, () => type);

describe('the journal of a run', () => {
  it('records ten calls made at once, one append at a time, each start before its answer', async () => {
    const { executing, history, user } = await brainWithToolUser();

    expect(await executing({ calls: 10 })).toMatchObject({
      status: 'succeeded',
      output: { output: { recorded: Array.from({ length: 20 }, () => true) } },
    });
    expect(await history()).toEqual([
      'execution_started',
      ...calls(10, 'tool_call_started'),
      ...calls(10, 'tool_call_answered'),
      'execution_succeeded',
    ]);
    expect(user.primitive.describeOutput({ recorded: [] })).toBe('It called its tools.');
  });

  it('records nothing more once the run has finished', async () => {
    const { executing, history, user } = await brainWithToolUser();
    await executing({ calls: 1 });

    expect(await user.recordedLate()).toEqual([false]);
    expect(await history()).toEqual([
      'execution_started',
      'tool_call_started',
      'tool_call_answered',
      'execution_succeeded',
    ]);
  });

  it('leaves a call in flight when the run is cancelled with a start and no answer', async () => {
    const { callCancelledWhen, executeSpec, history, user } = await brainWithToolUser();
    const request = toAlpha(acmeAdmin, {
      primitive: 'tool-user',
      name: 'caller',
      input: { calls: 1, ending: 'stall' },
      execution_id: executionId,
    });

    expect(await callCancelledWhen(user.stalled, executeSpec, request)).toEqual({ status: 'cancelled' });
    expect(await user.recordedLate()).toEqual([false]);
    expect(await history()).toEqual(['execution_started', 'tool_call_started', 'execution_failed']);
  });
});

describe('a run that called tools', () => {
  it.each(['unavailable', 'conflict'])(
    'is not run again under its id after it ended %s, and says to start a new run',
    async (ending) => {
      const { executing, user } = await brainWithToolUser();
      await executing({ calls: 1, ending });

      expect(await executing({ calls: 1, ending })).toMatchObject({
        status: 'rejected',
        reason: 'conflict',
        kind: 'tools_called',
      });
      expect(await user.recordedLate()).toEqual([false]);
    },
  );

  it('is answered again when it succeeded', async () => {
    const { executing, user } = await brainWithToolUser();
    const first = await executing({ calls: 2 });

    expect(await executing({ calls: 2 })).toEqual(first);
    expect(await user.recordedLate()).toEqual([false]);
  });

  it('left started by a server that died stays started, is listed as running, and is not run again', async () => {
    const { call, executing, getExecution, listExecutions, recordedDirectly } = await brainWithToolUser();
    await recordedDirectly(
      { type: 'start', primitive: 'tool-user', name: 'caller', input: {}, spec_version: 1, calls_tools: true, ...at },
      { type: 'tool_call', fact: startOfCall(1), ...at },
    );

    expect(await executing({})).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'tools_called' });
    expect(await call(getExecution, toAlpha(acmeAdmin, { execution_id: executionId }))).toMatchObject({
      output: { status: 'started' },
    });
    expect(await call(listExecutions, toAlpha(acmeAdmin, { status: 'started' }))).toMatchObject({
      output: { executions: [{ execution_id: executionId, status: 'started' }] },
    });
  });
});

describe('a run of a spec that calls tools, still in progress', () => {
  it('is not run again under its id while an earlier call still runs it, before any tool was called', async () => {
    const { callCancelledWhen, executeSpec, executing, history, user } = await brainWithToolUser();
    const first = toAlpha(acmeAdmin, {
      primitive: 'tool-user',
      name: 'caller',
      input: { calls: 0, ending: 'stall' },
      execution_id: executionId,
    });
    const retried = user.stalled.then(() => executing({ calls: 0, ending: 'stall' }));

    expect(await callCancelledWhen(retried, executeSpec, first)).toEqual({ status: 'cancelled' });
    expect(await retried).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'tools_called' });
    expect(await history()).toEqual(['execution_started', 'execution_failed']);
  });
});
