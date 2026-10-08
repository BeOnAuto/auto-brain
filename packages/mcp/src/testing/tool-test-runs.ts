import {
  Ledger,
  makeDispatcher,
  settle,
  type CallerIdentity,
  type RecordedEvent,
  type Settled,
} from '@beonauto/operations';
import {
  memoryBrainRegistry,
  memoryLedger,
  recordingReporter,
  type ReportedIncident,
} from '@beonauto/operations/testing';
import { Effect, Layer } from 'effect';

import type { ToolAccess } from '../access/tool-access.ts';
import { defineTestToolCall } from '../tool-tests/test-tool-call.ts';

export const toolTester: CallerIdentity = {
  id: 'acme-builder',
  org: 'acme',
  permissions: ['brain:read', 'brain:write'],
  brains: '*',
};

export interface TestAsking {
  readonly caller?: CallerIdentity;
  readonly brain?: string;
  readonly signal?: AbortSignal;
}

export interface ToolTests {
  readonly registration: ReturnType<typeof defineTestToolCall>['registration'];
  readonly test: (input: unknown, asking?: TestAsking) => Promise<Settled>;
  readonly recorded: () => Promise<readonly RecordedEvent[]>;
  readonly incidents: () => readonly ReportedIncident[];
}

export interface ToolTestsOptions {
  readonly writesRefused?: boolean;
}

function refusingWrites(ledger: Ledger['Service']): Layer.Layer<Ledger> {
  return Layer.succeed(
    Ledger,
    Ledger.of({ ...ledger, execute: () => Effect.die(new Error('The ledger refused the write')) }),
  );
}

export function toolTests(
  access: Pick<ToolAccess, 'open' | 'testing'>,
  { writesRefused = false }: ToolTestsOptions = {},
): ToolTests {
  const ledger = memoryLedger();
  const reporter = recordingReporter();
  const services = Layer.mergeAll(
    writesRefused ? refusingWrites(ledger.service) : ledger.layer,
    memoryBrainRegistry([{ org: 'acme', brain: 'alpha' }], [{ org: 'acme', brain: 'old' }]),
    reporter.layer,
  );
  const { registration } = defineTestToolCall(access);
  const dispatcher = makeDispatcher([]);
  return {
    registration,
    test: (input, { caller = toolTester, brain = 'alpha', signal } = {}) =>
      Effect.runPromise(
        settle(
          dispatcher.dispatchToBrain(registration, { caller, org: 'acme', brain, input, encoding: 'json' }),
          signal,
        ).pipe(Effect.provide(services)),
      ),
    recorded: async () => {
      const page = await Effect.runPromise(
        ledger.service.readRecorded(
          { org: 'acme', brain: 'alpha' },
          { kind: 'everything' },
          { order: 'asc', limit: 50 },
        ),
      );
      return page.records;
    },
    incidents: reporter.reported,
  };
}
