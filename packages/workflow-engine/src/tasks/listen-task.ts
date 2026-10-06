import { evaluate } from '../dsl/evaluation.ts';
import { field, isObject, objectField, textField, type JsonObject } from '../dsl/json.ts';
import type { Located } from '../dsl/policy-checks.ts';
import { eventFiltersOf } from '../dsl/task-policy.ts';
import { hasAttributes } from '../filters/event-filter.ts';
import type { FrameBody, ValueId } from '../machine/run-state.ts';
import { doneOf, waitingOn, type BodyAdvance, type Invocation, type Signal } from '../runner/advance.ts';

type ListenBody = Extract<FrameBody, { readonly kind: 'listen' }>;

type EventFilter = (event: JsonObject) => boolean;

function acceptsBy(properties: JsonObject, invocation: Invocation): EventFilter {
  return (event) =>
    hasAttributes(event, properties, (expression, value) =>
      evaluate(expression, value, invocation.variables, invocation.machine.session.placeAt(invocation.entry.reference)),
    );
}

function listenOf(invocation: Invocation): { readonly to: JsonObject; readonly read: string } {
  const listen = objectField(invocation.entry.task, 'listen') ?? {};
  return { to: objectField(listen, 'to') ?? {}, read: textField(listen, 'read') ?? 'data' };
}

function filtersOf(invocation: Invocation, to: JsonObject): readonly EventFilter[] {
  return eventFiltersOf(to, `${invocation.entry.reference}/listen/to`).map(([filter]: Located) =>
    acceptsBy(isObject(filter) ? (objectField(filter, 'with') ?? {}) : {}, invocation),
  );
}

function takeAll(
  invocation: Invocation,
  filters: readonly EventFilter[],
  consumed: readonly ValueId[],
): readonly ValueId[] {
  const accepts = filters[consumed.length];
  const event = accepts === undefined ? undefined : invocation.machine.session.takeEvent(accepts);
  return event === undefined
    ? consumed
    : takeAll(invocation, filters, [...consumed, invocation.machine.session.hold(event)]);
}

function taken(invocation: Invocation, consumed: readonly ValueId[]): readonly ValueId[] {
  const { to } = listenOf(invocation);
  const filters = filtersOf(invocation, to);
  if (field(to, 'all') !== undefined) {
    return takeAll(invocation, filters, consumed);
  }
  const event = invocation.machine.session.takeEvent((candidate) => filters.some((accepts) => accepts(candidate)));
  return event === undefined ? consumed : [invocation.machine.session.hold(event)];
}

function isSatisfied(invocation: Invocation, consumed: readonly ValueId[]): boolean {
  const { to } = listenOf(invocation);
  return field(to, 'all') === undefined ? consumed.length > 0 : consumed.length >= filtersOf(invocation, to).length;
}

function settled(invocation: Invocation, consumed: readonly ValueId[], waited: number): BodyAdvance {
  const { session } = invocation.machine;
  if (isSatisfied(invocation, consumed)) {
    const { read } = listenOf(invocation);
    const events = consumed.map((id) => session.valueOf(id));
    return doneOf(
      session.hold(
        events.map((event) => (read === 'data' && isObject(event) ? (field(event, 'data') ?? null) : event)),
      ),
    );
  }
  session.beforeWaiting();
  const { reference } = invocation.entry;
  session.record({ reference, run: invocation.frame.run, outcome: 'waiting', waitsFor: 'event', times: waited + 1 });
  return waitingOn({ kind: 'listen', consumed, waited: waited + 1 });
}

export function startListen(invocation: Invocation): BodyAdvance {
  return settled(invocation, taken(invocation, []), 0);
}

export function resumeListen(invocation: Invocation, body: ListenBody, signal: Signal): BodyAdvance | undefined {
  if (signal.kind !== 'events') {
    return undefined;
  }
  const consumed = taken(invocation, body.consumed);
  if (consumed.length === body.consumed.length) {
    return undefined;
  }
  const { frame } = invocation;
  invocation.machine.session.resumedFrom({ reference: frame.reference, run: frame.run, times: body.waited });
  return settled(invocation, consumed, body.waited);
}
