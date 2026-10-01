import {
  entriesOf,
  field,
  isObject,
  listField,
  objectField,
  textField,
  type Json,
  type JsonEntry,
  type JsonObject,
} from './json.ts';
import {
  durationRefusals,
  expressionRefusals,
  forbidden,
  refusal,
  retryPolicyRefusals,
  templateRefusals,
  timeoutRefusals,
  transformRefusals,
  type Components,
  type Located,
  type Refusal,
} from './policy-checks.ts';
import { kindOf, pointerTo, type TaskEntry, type TaskKind } from './tasks.ts';

type OwnRefusals = (task: JsonObject, reference: string, components: Components) => readonly Refusal[];

export const executeSpecFunction = 'execute_spec';

const outboundCalls = new Set(['http', 'grpc', 'openapi', 'asyncapi', 'a2a', 'mcp']);

const executeSpecArguments = new Set(['primitive', 'name', 'input']);

const refusalsByKind: Readonly<Record<TaskKind, OwnRefusals>> = {
  run: (_task, reference) => [
    forbidden(`${reference}/run`, 'run tasks (shell, script, container, workflow) are not allowed'),
  ],
  emit: (_task, reference) => [forbidden(`${reference}/emit`, 'emit is not supported in this version')],
  call: (task, reference) => callRefusals(task, reference),
  listen: (task, reference) => listenRefusals(task, reference),
  raise: (task, reference, components) => raiseRefusals(task, reference, components),
  wait: (task, reference) => durationRefusals(field(task, 'wait'), `${reference}/wait`),
  set: (task, reference) => templateRefusals(field(task, 'set'), `${reference}/set`),
  switch: (task, reference) => switchRefusals(task, reference),
  for: (task, reference) =>
    expressionRefusals(field(objectField(task, 'for') ?? {}, 'in'), `${reference}/for/in`).concat(
      expressionRefusals(field(task, 'while'), `${reference}/while`),
    ),
  try: (task, reference, components) =>
    catchRefusals(objectField(task, 'catch') ?? {}, `${reference}/catch`, components),
  fork: () => [],
  do: () => [],
};

export function ownRefusals({ task, reference }: TaskEntry, components: Components): readonly Refusal[] {
  const kind = kindOf(task);
  return kind === undefined
    ? [refusal(reference, 'The task has no type this runtime knows')]
    : refusalsByKind[kind](task, reference, components);
}

export function commonRefusals({ task, reference }: TaskEntry, components: Components): readonly Refusal[] {
  return expressionRefusals(field(task, 'if'), `${reference}/if`).concat(
    dataRefusals(task, reference, 'input', 'from'),
    dataRefusals(task, reference, 'output', 'as'),
    dataRefusals(task, reference, 'export', 'as'),
    timeoutRefusals(field(task, 'timeout'), `${reference}/timeout`, components),
  );
}

export function eventFiltersOf(to: JsonObject, pointer: string): readonly Located[] {
  const one = field(to, 'one');
  if (one !== undefined) {
    return [[one, `${pointer}/one`]];
  }
  const strategy = field(to, 'all') === undefined ? 'any' : 'all';
  return (listField(to, strategy) ?? []).map((filter, index): Located => [filter, `${pointer}/${strategy}/${index}`]);
}

function dataRefusals(task: JsonObject, reference: string, part: string, transform: string): readonly Refusal[] {
  const data = objectField(task, part) ?? {};
  const schema =
    field(data, 'schema') === undefined
      ? []
      : [forbidden(`${reference}/${part}/schema`, 'Task schemas are not checked in this version; leave them out')];
  return schema.concat(transformRefusals(field(data, transform), `${reference}/${part}/${transform}`));
}

function callRefusals(task: JsonObject, reference: string): readonly Refusal[] {
  const name = textField(task, 'call') ?? '';
  if (outboundCalls.has(name)) {
    return [
      forbidden(
        `${reference}/call`,
        `call: ${name} is not allowed: a workflow reaches the world only through the specs of its brain; call ${executeSpecFunction}`,
      ),
    ];
  }
  return name === executeSpecFunction
    ? executeSpecRefusals(field(task, 'with'), `${reference}/with`)
    : [forbidden(`${reference}/call`, `call: ${name} names no function; the one function is ${executeSpecFunction}`)];
}

function executeSpecRefusals(arguments_: Json | undefined, pointer: string): readonly Refusal[] {
  if (!isObject(arguments_)) {
    return [refusal(pointer, `${executeSpecFunction} takes with: { primitive, name, input }`)];
  }
  const unknown = Object.keys(arguments_)
    .filter((key) => !executeSpecArguments.has(key))
    .map((key) => refusal(pointerTo(pointer, key), `${executeSpecFunction} takes no argument ${key}`));
  const missing = ['primitive', 'name']
    .filter((key) => typeof field(arguments_, key) !== 'string')
    .map((key) => refusal(pointerTo(pointer, key), `${executeSpecFunction} needs a string ${key}`));
  const workflow =
    field(arguments_, 'primitive') === 'orchestration'
      ? [forbidden(`${pointer}/primitive`, 'A workflow cannot execute another workflow in this version')]
      : [];
  return unknown.concat(missing, workflow, templateRefusals(arguments_, pointer));
}

function listenRefusals(task: JsonObject, reference: string): readonly Refusal[] {
  const to = objectField(objectField(task, 'listen') ?? {}, 'to') ?? {};
  const pointer = `${reference}/listen/to`;
  const until =
    field(to, 'until') === undefined
      ? []
      : [forbidden(`${pointer}/until`, 'listen until is not supported in this version')];
  const foreach =
    field(task, 'foreach') === undefined
      ? []
      : [forbidden(`${reference}/foreach`, 'listen foreach is not supported in this version')];
  return until.concat(
    foreach,
    eventFiltersOf(to, pointer).flatMap(([filter, at]: Located) => eventFilterRefusals(filter, at)),
  );
}

function eventFilterRefusals(filter: Json | undefined, pointer: string): readonly Refusal[] {
  if (!isObject(filter)) {
    return [];
  }
  const correlate =
    field(filter, 'correlate') === undefined
      ? []
      : [forbidden(`${pointer}/correlate`, 'Correlating events is not supported in this version')];
  return correlate.concat(templateRefusals(field(filter, 'with'), `${pointer}/with`));
}

function raiseRefusals(task: JsonObject, reference: string, components: Components): readonly Refusal[] {
  const error = field(objectField(task, 'raise') ?? {}, 'error');
  const pointer = `${reference}/raise/error`;
  if (typeof error === 'string') {
    return field(components.errors, error) === undefined ? [refusal(pointer, `use.errors has no error ${error}`)] : [];
  }
  return templateRefusals(error, pointer);
}

function switchRefusals(task: JsonObject, reference: string): readonly Refusal[] {
  return (listField(task, 'switch') ?? []).flatMap((item, index) =>
    isObject(item)
      ? entriesOf(item).flatMap(([name, switchCase]: JsonEntry) =>
          isObject(switchCase)
            ? expressionRefusals(field(switchCase, 'when'), pointerTo(`${reference}/switch/${index}`, name) + '/when')
            : [],
        )
      : [],
  );
}

function catchRefusals(handler: JsonObject, pointer: string, components: Components): readonly Refusal[] {
  return expressionRefusals(field(handler, 'when'), `${pointer}/when`).concat(
    expressionRefusals(field(handler, 'exceptWhen'), `${pointer}/exceptWhen`),
    retryRefusals(field(handler, 'retry'), `${pointer}/retry`, components),
  );
}

function retryRefusals(retry: Json | undefined, pointer: string, components: Components): readonly Refusal[] {
  if (typeof retry === 'string') {
    return field(components.retries, retry) === undefined
      ? [refusal(pointer, `use.retries has no retry policy ${retry}`)]
      : [];
  }
  return isObject(retry) ? retryPolicyRefusals(retry, pointer) : [];
}
