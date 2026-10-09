import {
  defineCancelRun,
  defineCreateDefinition,
  defineRunDefinition,
  defineGetRun,
  type BrainOperation,
  type Capability,
} from '@beonauto/definitions';
import {
  allPermissions,
  makeDispatcher,
  type CallerIdentity,
  type DispatcherServices,
  type Ledger,
  type Outcome,
} from '@beonauto/operations';
import { memoryBrainRegistry, memoryLedger, recordingReporter } from '@beonauto/operations/testing';
import { Effect, Layer } from 'effect';

import { makeInteractionFunctionAdapter } from '../capability/interaction-function.ts';
import { openRequests, openRequestsName } from '../requests/open-requests.ts';
import { requestsDue, type DueRequestItem, type RequestsDue } from '../schedule/due-requests.ts';
import { noTools, type ToolPorts } from './fake-tools.ts';
import { dueInBothLanes, firstOpenOf, performedAll, performedEach } from './harness-parts.ts';

export const acmeAdmin: CallerIdentity = { id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' };

export const alpha = { org: 'acme', brain: 'alpha' };

type RequestLedger = Parameters<typeof requestsDue>[0]['ledger'];

export interface HarnessLedger {
  readonly service: Ledger['Service'];
  readonly layer: Layer.Layer<Ledger>;
}

export type HarnessTools = ToolPorts;

export interface HarnessOptions {
  readonly ledger?: HarnessLedger | undefined;
  readonly tools?: HarnessTools;
  readonly mostOpenRequests?: number;
}

export interface InteractionHarness {
  readonly ledger: HarnessLedger;
  readonly capability: Capability;
  readonly due: RequestsDue;
  readonly call: (operation: BrainOperation, input: unknown, caller?: CallerIdentity) => Promise<Outcome>;
  readonly define: (name: string, source: string) => Promise<Outcome>;
  readonly ask: (name: string, input: unknown, runId: string) => Promise<Outcome>;
  readonly cancel: (runId: string) => Promise<Outcome>;
  readonly runOf: (runId: string) => Promise<Outcome>;
  readonly performDue: (now: number) => Promise<number>;
  readonly firstOpen: () => Promise<unknown>;
  readonly dueOver: (over: RequestLedger) => RequestsDue;
  readonly dueItems: (now: number, due?: RequestsDue) => Promise<readonly DueRequestItem[]>;
  readonly performAll: (items: readonly DueRequestItem[], now: number) => Promise<void>;
  readonly performEach: (times: readonly number[]) => Promise<void>;
}

export function interactionHarness(options: HarnessOptions = {}): InteractionHarness {
  const ledger: HarnessLedger = options.ledger ?? memoryLedger(undefined, [openRequests]);
  const tools = options.tools ?? noTools;
  const capability = makeInteractionFunctionAdapter({
    tools,
    openRequests: (brain) =>
      ledger.service.countProjectedRows(openRequestsName, brain, [{ column: 'open', equals: true }]),
    mostOpenRequests: options.mostOpenRequests ?? 10_000,
  });
  const services = Layer.mergeAll(ledger.layer, memoryBrainRegistry([alpha]), recordingReporter().layer);
  const dispatcher = makeDispatcher([]);
  const run = <A>(calls: Effect.Effect<A, never, DispatcherServices>) =>
    Effect.runPromise(calls.pipe(Effect.provide(services)));
  const call: InteractionHarness['call'] = (operation, input, caller = acmeAdmin) =>
    run(dispatcher.dispatchToBrain(operation.registration, { caller, ...alpha, input, encoding: 'json' }));
  const dueOver = (over: RequestLedger): RequestsDue => requestsDue({ ledger: over, tools });
  const due = dueOver(ledger.service);
  const capabilities = [capability];
  const performDue = async (now: number): Promise<number> => {
    const items = await dueInBothLanes(due, now);
    await performedAll(items, now);
    return items.length;
  };
  return {
    ledger,
    capability,
    due,
    call,
    define: (name, source) => call(defineCreateDefinition(capabilities), { type: 'interaction', name, source }),
    ask: (name, input, runId) =>
      call(defineRunDefinition(capabilities), { type: 'interaction', name, input, run_id: runId }),
    cancel: (runId) => call(defineCancelRun(capabilities), { run_id: runId }),
    runOf: (runId) => call(defineGetRun(capabilities), { run_id: runId }),
    performDue,
    dueOver,
    dueItems: (now, from = due) => dueInBothLanes(from, now),
    performAll: performedAll,
    performEach: (times) => performedEach(times, performDue),
    firstOpen: () => firstOpenOf(call),
  };
}
