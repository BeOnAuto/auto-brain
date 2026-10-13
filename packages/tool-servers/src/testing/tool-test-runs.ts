import {
  Ledger,
  makeDispatcher,
  settle,
  type CallerIdentity,
  type RecordedEvent,
  type Settled,
} from '@on.auto/operations';
import {
  memoryPlaybookRegistry,
  memoryLedger,
  recordingReporter,
  type ReportedIncident,
} from '@on.auto/operations/testing';
import { Effect, Layer } from 'effect';

import type { ToolAccess } from '../access/tool-access.ts';
import { defineTestToolCall } from '../tool-tests/test-tool-call.ts';

export const toolTester: CallerIdentity = {
  id: 'acme-builder',
  org: 'acme',
  permissions: ['playbook:read', 'playbook:write'],
  playbooks: '*',
};

export interface TestAsking {
  readonly caller?: CallerIdentity;
  readonly playbook?: string;
  readonly signal?: AbortSignal;
}

export interface ToolTests {
  readonly registration: ReturnType<typeof defineTestToolCall>['registration'];
  readonly test: (input: unknown, asking?: TestAsking) => Promise<Settled>;
  readonly recorded: () => Promise<readonly RecordedEvent[]>;
  readonly incidents: () => readonly ReportedIncident[];
  readonly writesAttempted: () => number;
}

export interface ToolTestsOptions {
  readonly writesRefused?: boolean;
  readonly writesHeldUntil?: Promise<void>;
}

interface Refusing {
  readonly held: Promise<void>;
  readonly attempted: () => void;
}

function refusingWrites(ledger: Ledger['Service'], { held, attempted }: Refusing): Layer.Layer<Ledger> {
  const refused = Effect.sync(attempted).pipe(
    Effect.andThen(Effect.promise(() => held)),
    Effect.andThen(Effect.die(new Error('The ledger refused the write'))),
  );
  return Layer.succeed(Ledger, Ledger.of({ ...ledger, execute: () => refused }));
}

export function toolTests(
  access: Pick<ToolAccess, 'open' | 'testing'>,
  { writesRefused = false, writesHeldUntil = Promise.resolve() }: ToolTestsOptions = {},
): ToolTests {
  const ledger = memoryLedger();
  const reporter = recordingReporter();
  const writes = { attempted: 0 };
  const refusing = {
    held: writesHeldUntil,
    attempted: () => {
      writes.attempted += 1;
    },
  };
  const services = Layer.mergeAll(
    writesRefused ? refusingWrites(ledger.service, refusing) : ledger.layer,
    memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }], [{ org: 'acme', playbook: 'old' }]),
    reporter.layer,
  );
  const { registration } = defineTestToolCall(access);
  const dispatcher = makeDispatcher([]);
  return {
    registration,
    test: (input, { caller = toolTester, playbook = 'alpha', signal } = {}) =>
      Effect.runPromise(
        settle(
          dispatcher.dispatchToPlaybook(registration, { caller, org: 'acme', playbook, input, encoding: 'json' }),
          signal,
        ).pipe(Effect.provide(services)),
      ),
    recorded: async () => {
      const page = await Effect.runPromise(
        ledger.service.readRecorded(
          { org: 'acme', playbook: 'alpha' },
          { kind: 'everything' },
          { order: 'asc', limit: 50 },
        ),
      );
      return page.records;
    },
    incidents: reporter.reported,
    writesAttempted: () => writes.attempted,
  };
}
