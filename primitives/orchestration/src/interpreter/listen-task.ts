import { enclosedBody } from '../dsl/expressions.ts';
import {
  entriesOf,
  field,
  isObject,
  jsonEquals,
  objectField,
  textField,
  type Json,
  type JsonEntry,
  type JsonObject,
} from '../dsl/json.ts';
import type { Located } from '../dsl/policy-checks.ts';
import { eventFiltersOf } from '../dsl/task-policy.ts';
import { evaluate, placeOf } from './evaluation.ts';
import type { Body, Invocation } from './invocation.ts';
import type { EventFilter } from './run-state.ts';

export async function listenTask(invocation: Invocation): Promise<Body> {
  const { entry } = invocation;
  const listen = objectField(entry.task, 'listen') ?? {};
  const to = objectField(listen, 'to') ?? {};
  const filters = eventFiltersOf(to, `${entry.reference}/listen/to`).map(([filter]: Located) =>
    acceptsBy(isObject(filter) ? (objectField(filter, 'with') ?? {}) : {}, invocation),
  );
  const consumed =
    field(to, 'all') === undefined
      ? [await nextEvent(invocation, (event) => filters.some((accepts) => accepts(event)))]
      : await eachInTurn(invocation, filters, []);
  const read = textField(listen, 'read') ?? 'data';
  return { output: consumed.map((event) => (read === 'data' ? (field(event, 'data') ?? null) : event)) };
}

async function eachInTurn(
  invocation: Invocation,
  filters: readonly EventFilter[],
  consumed: readonly JsonObject[],
): Promise<readonly JsonObject[]> {
  const [accepts, ...rest] = filters;
  if (accepts === undefined) {
    return consumed;
  }
  return eachInTurn(invocation, rest, [...consumed, await nextEvent(invocation, accepts)]);
}

async function nextEvent(invocation: Invocation, accepts: EventFilter): Promise<JsonObject> {
  const { state } = invocation.scope;
  const delivered = state.eventsDelivered();
  const event = state.takeEvent(accepts);
  if (event !== undefined) {
    return event;
  }
  state.beforeWaiting(invocation.entry.reference);
  await state.host.waitUntil(() => state.eventsDelivered() > delivered);
  return nextEvent(invocation, accepts);
}

function acceptsBy(properties: JsonObject, invocation: Invocation): EventFilter {
  return (event) =>
    entriesOf(properties).every(([name, expected]: JsonEntry) =>
      propertyMatches(expected, field(event, name) ?? null, invocation),
    );
}

function propertyMatches(expected: Json, actual: Json, invocation: Invocation): boolean {
  const body = enclosedBody(expected);
  if (body === undefined) {
    return jsonEquals(expected, actual);
  }
  const verdict = evaluate(body, actual, invocation.variables, placeOf(invocation));
  return verdict !== null && verdict !== false;
}
