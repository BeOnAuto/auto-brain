import { Effect, Exit, Layer, Logger, Schema, Scope } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { settingsFor } from '../testing/temporal.ts';
import { runFor, workflow } from '../testing/workflows.ts';
import { connectOrchestration, eventUnavailable, startUnavailable } from './orchestration-client.ts';

const decodeLine = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      message: Schema.String,
      level: Schema.String,
      annotations: Schema.Struct({ error: Schema.String, suppressed: Schema.Number }),
    }),
  ),
);

const execution = { org: 'acme', brain: 'alpha', spec: 'test-flow', executionId: 'unreachable' };

describe('a client whose Temporal cannot be reached', () => {
  it("answers each call with a fixed detail, and logs Temporal's error for the operator at most once a minute", async () => {
    const scope = Effect.runSync(Scope.make());
    const client = await Effect.runPromise(
      connectOrchestration({ ...settingsFor('unreachable'), address: '127.0.0.1:1' }, { requestTimeout: 300 }).pipe(
        Scope.provide(scope),
      ),
    );
    const lines: string[] = [];
    const capture = Logger.map(Logger.formatJson, (line: string) => {
      lines.push(line);
    });

    const details = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* Effect.flip(client.start(runFor(workflow('do: []'), 'unreachable')));
        const second = yield* Effect.flip(client.signal(execution, { type: 'go' }));
        yield* TestClock.adjust('1 minute');
        const third = yield* Effect.flip(client.start(runFor(workflow('do: []'), 'unreachable')));
        return [first.detail, second.detail, third.detail];
      }).pipe(Effect.provide(Layer.mergeAll(Logger.layer([capture]), TestClock.layer()))),
    );
    await Effect.runPromise(Scope.close(scope, Exit.void));
    const logged = lines.map((line) => decodeLine(line));

    expect(details).toStrictEqual([startUnavailable, eventUnavailable, startUnavailable]);
    expect(logged.map(({ level, message, annotations }) => [level, message, annotations.suppressed])).toStrictEqual([
      ['WARN', 'Temporal could not start a workflow', 0],
      ['WARN', 'Temporal could not start a workflow', 1],
    ]);
    expect(logged[0]?.annotations.error).toBe('Error: Temporal did not answer within 300 ms');
  }, 30_000);
});
