import { namesOf, theFunctions, type CallFunctions } from './call-functions.ts';
import {
  entriesOf,
  field,
  isList,
  isObject,
  listField,
  objectField,
  textField,
  type Json,
  type JsonEntry,
  type JsonObject,
} from './json.ts';
import {
  durationRejections,
  expressionRejections,
  forbidden,
  rejection,
  retryPolicyRejections,
  templateRejections,
  timeoutRejections,
  transformRejections,
  type Components,
  type Located,
  type Rejection,
} from './policy-checks.ts';
import { kindOf, pointerTo, type TaskEntry, type TaskKind } from './tasks.ts';

type OwnRejections = (task: JsonObject, reference: string, components: Components) => readonly Rejection[];

const mostForkBranches = 32;

const outboundCalls = new Set(['http', 'grpc', 'openapi', 'asyncapi', 'a2a', 'mcp']);

const rejectionsByKind: Readonly<Record<Exclude<TaskKind, 'call'>, OwnRejections>> = {
  run: (_task, reference) => [
    forbidden(`${reference}/run`, 'run tasks (shell, script, container, workflow) are not allowed'),
  ],
  emit: (_task, reference) => [forbidden(`${reference}/emit`, 'emit is not supported in this version')],
  listen: (task, reference) => listenRejections(task, reference),
  raise: (task, reference, components) => raiseRejections(task, reference, components),
  wait: (task, reference) => durationRejections(field(task, 'wait'), `${reference}/wait`),
  set: (task, reference) => templateRejections(field(task, 'set'), `${reference}/set`),
  switch: (task, reference) => switchRejections(task, reference),
  for: (task, reference) =>
    expressionRejections(field(objectField(task, 'for') ?? {}, 'in'), `${reference}/for/in`).concat(
      expressionRejections(field(task, 'while'), `${reference}/while`),
    ),
  try: (task, reference, components) =>
    catchRejections(objectField(task, 'catch') ?? {}, `${reference}/catch`, components),
  fork: (task, reference) => forkRejections(task, reference),
  do: () => [],
};

export function ownRejections(
  { task, reference }: TaskEntry,
  components: Components,
  functions: CallFunctions,
): readonly Rejection[] {
  const kind = kindOf(task);
  if (kind === undefined) {
    return [rejection(reference, 'The task has no type this runtime knows')];
  }
  return kind === 'call'
    ? callRejections(task, reference, functions)
    : rejectionsByKind[kind](task, reference, components);
}

export function commonRejections({ task, reference }: TaskEntry, components: Components): readonly Rejection[] {
  return expressionRejections(field(task, 'if'), `${reference}/if`).concat(
    dataRejections(task, reference, 'input', 'from'),
    dataRejections(task, reference, 'output', 'as'),
    dataRejections(task, reference, 'export', 'as'),
    timeoutRejections(field(task, 'timeout'), `${reference}/timeout`, components),
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

function dataRejections(task: JsonObject, reference: string, part: string, transform: string): readonly Rejection[] {
  const data = objectField(task, part) ?? {};
  const schema =
    field(data, 'schema') === undefined
      ? []
      : [forbidden(`${reference}/${part}/schema`, 'Task schemas are not checked in this version; leave them out')];
  return schema.concat(transformRejections(field(data, transform), `${reference}/${part}/${transform}`));
}

function callRejections(task: JsonObject, reference: string, functions: CallFunctions): readonly Rejection[] {
  const name = textField(task, 'call') ?? '';
  if (outboundCalls.has(name)) {
    return [
      forbidden(
        `${reference}/call`,
        `call: ${name} is not allowed: ${functions.howAWorkflowReachesTheWorld}; call ${namesOf(functions)}`,
      ),
    ];
  }
  const argumentChecks = Object.hasOwn(functions.argumentChecks, name) ? functions.argumentChecks[name] : undefined;
  return argumentChecks === undefined
    ? [forbidden(`${reference}/call`, `call: ${name} names no function; ${theFunctions(functions)}`)]
    : argumentChecks(field(task, 'with'), `${reference}/with`);
}

function listenRejections(task: JsonObject, reference: string): readonly Rejection[] {
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
    eventFiltersOf(to, pointer).flatMap(([filter, at]: Located) => eventFilterRejections(filter, at)),
  );
}

function eventFilterRejections(filter: Json | undefined, pointer: string): readonly Rejection[] {
  if (!isObject(filter)) {
    return [];
  }
  const correlate =
    field(filter, 'correlate') === undefined
      ? []
      : [forbidden(`${pointer}/correlate`, 'Correlating events is not supported in this version')];
  return correlate.concat(templateRejections(field(filter, 'with'), `${pointer}/with`));
}

function raiseRejections(task: JsonObject, reference: string, components: Components): readonly Rejection[] {
  const error = field(objectField(task, 'raise') ?? {}, 'error');
  const pointer = `${reference}/raise/error`;
  if (typeof error === 'string') {
    return field(components.errors, error) === undefined
      ? [rejection(pointer, `use.errors has no error ${error}`)]
      : [];
  }
  return templateRejections(error, pointer);
}

function switchRejections(task: JsonObject, reference: string): readonly Rejection[] {
  return (listField(task, 'switch') ?? []).flatMap((item, index) =>
    isObject(item)
      ? entriesOf(item).flatMap(([name, switchCase]: JsonEntry) =>
          isObject(switchCase)
            ? expressionRejections(field(switchCase, 'when'), pointerTo(`${reference}/switch/${index}`, name) + '/when')
            : [],
        )
      : [],
  );
}

function catchRejections(handler: JsonObject, pointer: string, components: Components): readonly Rejection[] {
  return expressionRejections(field(handler, 'when'), `${pointer}/when`).concat(
    expressionRejections(field(handler, 'exceptWhen'), `${pointer}/exceptWhen`),
    retryRejections(field(handler, 'retry'), `${pointer}/retry`, components),
  );
}

function retryRejections(retry: Json | undefined, pointer: string, components: Components): readonly Rejection[] {
  if (typeof retry === 'string') {
    return field(components.retries, retry) === undefined
      ? [rejection(pointer, `use.retries has no retry policy ${retry}`)]
      : [];
  }
  return isObject(retry) ? retryPolicyRejections(retry, pointer) : [];
}

function forkRejections(task: JsonObject, reference: string): readonly Rejection[] {
  const branches = field(objectField(task, 'fork') ?? {}, 'branches');
  return isList(branches) && branches.length > mostForkBranches
    ? [
        forbidden(
          `${reference}/fork/branches`,
          `A fork may have at most ${mostForkBranches} branches, not ${branches.length}`,
        ),
      ]
    : [];
}
