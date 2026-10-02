import { once } from 'node:events';
import { createServer } from 'node:net';

import { Effect, Exit, Layer, Logger, Schema, Scope } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { settingsFor } from '../testing/temporal.ts';
import { runFor, workflow } from '../testing/workflows.ts';
import {
  connectOrchestration,
  eventUnavailable,
  startUnavailable,
  type OrchestrationClient,
} from './orchestration-client.ts';

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

type Call = (client: OrchestrationClient) => Effect.Effect<string, unknown>;

function detailOf({ detail }: { readonly detail: string }): string {
  return detail;
}

const starting: Call = (client) =>
  Effect.map(Effect.flip(client.start(runFor(workflow('do: []'), 'unreachable'))), detailOf);

const startingTooLongAnId: Call = (client) =>
  Effect.map(Effect.flip(client.start(runFor(workflow('do: []'), 'x'.repeat(1100)))), detailOf);

const signalling: Call = (client) => Effect.map(Effect.flip(client.signal(execution, { type: 'go' })), detailOf);

interface Failures {
  readonly details: readonly string[];
  readonly logged: readonly (readonly [string, string, number, string])[];
}

async function failuresOf(address: string, namespace: string, calls: readonly [Call, Call, Call]): Promise<Failures> {
  const scope = Effect.runSync(Scope.make());
  const settings = { ...settingsFor('unreachable'), address, namespace };
  const client = await Effect.runPromise(
    connectOrchestration(settings, { requestTimeout: 300 }).pipe(Scope.provide(scope)),
  );
  const lines: string[] = [];
  const capture = Logger.map(Logger.formatJson, (line: string) => {
    lines.push(line);
  });
  const [first, second, last] = calls;
  const details = await Effect.runPromise(
    Effect.gen(function* () {
      const answered = [yield* first(client), yield* second(client)];
      yield* TestClock.adjust('1 minute');
      return [...answered, yield* last(client)];
    }).pipe(Effect.provide(Layer.mergeAll(Logger.layer([capture]), TestClock.layer()))),
  );
  await Effect.runPromise(Scope.close(scope, Exit.void));
  const logged = lines.map((line) => decodeLine(line));
  return {
    details,
    logged: logged.map(({ level, message, annotations }) => [
      level,
      message,
      annotations.suppressed,
      annotations.error,
    ]),
  };
}

async function listening(): Promise<{ readonly address: string; readonly close: () => void }> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address());
  return {
    address: `127.0.0.1:${port}`,
    close: () => {
      server.close();
    },
  };
}

describe('a client whose Temporal accepts the connection and never answers', () => {
  it('answers each call with a fixed detail when its deadline passes, and logs that deadline for the operator at most once a minute', async () => {
    const silent = await listening();
    onTestFinished(silent.close);

    const failures = await failuresOf(silent.address, 'default', [starting, signalling, starting]);

    expect(failures).toStrictEqual({
      details: [startUnavailable, eventUnavailable, startUnavailable],
      logged: [
        ['WARN', 'Temporal could not start a workflow', 0, 'Error: Temporal did not answer within 300 ms'],
        ['WARN', 'Temporal could not start a workflow', 1, 'Error: Temporal did not answer within 300 ms'],
      ],
    });
  }, 30_000);
});

describe('a client whose Temporal refuses the connection', () => {
  it('answers the same when its deadline passes, while the client still retries the refused connection', async () => {
    const refusing = await listening();
    refusing.close();

    const failures = await failuresOf(refusing.address, 'default', [starting, signalling, starting]);

    expect(failures).toStrictEqual({
      details: [startUnavailable, eventUnavailable, startUnavailable],
      logged: [
        ['WARN', 'Temporal could not start a workflow', 0, 'Error: Temporal did not answer within 300 ms'],
        ['WARN', 'Temporal could not start a workflow', 1, 'Error: Temporal did not answer within 300 ms'],
      ],
    });
  }, 30_000);
});

describe('a client whose Temporal answers with an error', () => {
  it('answers each call with the same fixed detail, and logs only the fixed message of the service error', async () => {
    const failures = await failuresOf(settingsFor('unreachable').address, 'default', [
      startingTooLongAnId,
      startingTooLongAnId,
      startingTooLongAnId,
    ]);

    expect(failures).toStrictEqual({
      details: [startUnavailable, startUnavailable, startUnavailable],
      logged: [
        ['WARN', 'Temporal could not start a workflow', 0, 'ServiceError: Failed to start Workflow'],
        ['WARN', 'Temporal could not start a workflow', 1, 'ServiceError: Failed to start Workflow'],
      ],
    });
  }, 30_000);

  it('logs the namespace the operator set when Temporal does not have it', async () => {
    const failures = await failuresOf(settingsFor('unreachable').address, 'no-such-namespace', [
      starting,
      starting,
      starting,
    ]);

    expect(failures.details).toStrictEqual([startUnavailable, startUnavailable, startUnavailable]);
    expect(failures.logged.map(([, , , error]) => error)).toStrictEqual([
      "NamespaceNotFoundError: Namespace not found: 'no-such-namespace'",
      "NamespaceNotFoundError: Namespace not found: 'no-such-namespace'",
    ]);
  }, 30_000);
});
