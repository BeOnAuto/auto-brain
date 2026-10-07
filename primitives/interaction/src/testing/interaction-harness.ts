import {
  allPermissions,
  makeDispatcher,
  type CallerIdentity,
  type DispatcherServices,
  type Ledger,
  type Outcome,
} from '@beonauto/operations';
import { memoryBrainRegistry, memoryLedger, recordingReporter } from '@beonauto/operations/testing';
import type { OutboundFetch } from '@beonauto/outbound';
import {
  defineCancelExecution,
  defineCreateSpec,
  defineExecuteSpec,
  defineGetExecution,
  type BrainOperation,
  type Primitive,
} from '@beonauto/specs';
import { Effect, Layer } from 'effect';

import { noChannels, type ChannelSettings } from '../channels/channel-settings.ts';
import { makeInteractionFunctionAdapter } from '../primitive/interaction-function.ts';
import { openRequests, openRequestsName } from '../requests/open-requests.ts';
import { requestsDue, type DueRequestItem, type RequestsDue } from '../schedule/due-requests.ts';
import { firstOpenOf, noTools, performedAll, performedEach } from './harness-parts.ts';

export const acmeAdmin: CallerIdentity = { id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' };

export const alpha = { org: 'acme', brain: 'alpha' };

type RequestLedger = Parameters<typeof requestsDue>[0]['ledger'];

export interface HarnessLedger {
  readonly service: Ledger['Service'];
  readonly layer: Layer.Layer<Ledger>;
}

export interface HarnessOptions {
  readonly ledger?: HarnessLedger | undefined;
  readonly channels?: ChannelSettings;
  readonly tools?: typeof noTools;
  readonly mostOpenRequests?: number;
  readonly fetch?: OutboundFetch;
}

export interface InteractionHarness {
  readonly ledger: HarnessLedger;
  readonly primitive: Primitive;
  readonly due: RequestsDue;
  readonly call: (operation: BrainOperation, input: unknown, caller?: CallerIdentity) => Promise<Outcome>;
  readonly define: (name: string, source: string) => Promise<Outcome>;
  readonly ask: (name: string, input: unknown, executionId: string) => Promise<Outcome>;
  readonly cancel: (executionId: string) => Promise<Outcome>;
  readonly runOf: (executionId: string) => Promise<Outcome>;
  readonly performDue: (now: number) => Promise<number>;
  readonly firstOpen: () => Promise<unknown>;
  readonly dueWith: (channels: ChannelSettings) => RequestsDue;
  readonly dueOver: (over: RequestLedger) => RequestsDue;
  readonly dueItems: (now: number, due?: RequestsDue) => Promise<readonly DueRequestItem[]>;
  readonly performAll: (items: readonly DueRequestItem[], now: number) => Promise<void>;
  readonly performEach: (times: readonly number[]) => Promise<void>;
}

export function interactionHarness(options: HarnessOptions = {}): InteractionHarness {
  const ledger: HarnessLedger = options.ledger ?? memoryLedger(undefined, [openRequests]);
  const channels = options.channels ?? noChannels;
  const primitive = makeInteractionFunctionAdapter({
    channels,
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
  const dueOn = (over: RequestLedger, given: ChannelSettings): RequestsDue =>
    requestsDue({
      ledger: over,
      channels: given,
      tools: options.tools ?? noTools,
      origin: 'https://brains.example.com',
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  const dueWith = (given: ChannelSettings): RequestsDue => dueOn(ledger.service, given);
  const due = dueWith(channels);
  const primitives = [primitive];
  const performDue = async (now: number): Promise<number> => {
    const items = await Effect.runPromise(due.due(now, 256));
    await performedAll(items, now);
    return items.length;
  };
  return {
    ledger,
    primitive,
    due,
    call,
    define: (name, source) => call(defineCreateSpec(primitives), { primitive: 'interaction', name, source }),
    ask: (name, input, executionId) =>
      call(defineExecuteSpec(primitives), { primitive: 'interaction', name, input, execution_id: executionId }),
    cancel: (executionId) => call(defineCancelExecution(primitives), { execution_id: executionId }),
    runOf: (executionId) => call(defineGetExecution(primitives), { execution_id: executionId }),
    performDue,
    dueWith,
    dueOver: (over) => dueOn(over, channels),
    dueItems: (now, from = due) => Effect.runPromise(from.due(now, 256)),
    performAll: performedAll,
    performEach: (times) => performedEach(times, performDue),
    firstOpen: () => firstOpenOf(call),
  };
}
