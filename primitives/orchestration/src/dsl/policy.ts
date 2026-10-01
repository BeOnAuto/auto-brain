import {
  entriesOf,
  field,
  isObject,
  objectField,
  textField,
  type Json,
  type JsonEntry,
  type JsonObject,
} from './json.ts';
import {
  durationRefusals,
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
import { commonRefusals, ownRefusals } from './task-policy.ts';
import { kindOf, pointerTo, taskEntries, type TaskEntry } from './tasks.ts';

const refusedComponents: Readonly<Record<string, string>> = {
  authentications: 'authentications are not supported in this version: a workflow reaches nothing that needs them',
  secrets: 'secrets are not supported in this version: a workflow reaches nothing that needs them',
  catalogs: 'catalogs are not supported in this version: a workflow calls only execute_spec',
  extensions: 'extensions are not supported in this version',
  functions: 'reusable functions are not supported in this version: call execute_spec directly',
};

const flowDirectives = new Set(['continue', 'exit', 'end']);

export function refusalsOf(document: JsonObject): readonly Refusal[] {
  const use = objectField(document, 'use') ?? {};
  const components = {
    errors: objectField(use, 'errors') ?? {},
    retries: objectField(use, 'retries') ?? {},
    timeouts: objectField(use, 'timeouts') ?? {},
  };
  const schedule =
    field(document, 'schedule') === undefined
      ? []
      : [forbidden('/schedule', 'schedules are not supported in this version: execute the spec to run it')];
  return versionRefusals(document).concat(
    componentRefusals(use, components),
    schedule,
    workflowDataRefusals(document),
    timeoutRefusals(field(document, 'timeout'), '/timeout', components),
    taskListRefusals(field(document, 'do'), '/do', components),
  );
}

function versionRefusals(document: JsonObject): readonly Refusal[] {
  const dsl = textField(objectField(document, 'document') ?? {}, 'dsl');
  return dsl !== undefined && /^1\.0\.\d+$/u.test(dsl)
    ? []
    : [forbidden('/document/dsl', `This runtime runs documents of DSL 1.0.x, not ${dsl ?? 'an unnamed version'}`)];
}

function componentRefusals(use: JsonObject, components: Components): readonly Refusal[] {
  const refused = Object.entries(refusedComponents)
    .filter(([name]: readonly [string, string]) => field(use, name) !== undefined)
    .map(([name, detail]: readonly [string, string]) => forbidden(`/use/${name}`, detail));
  const retries = entriesOf(components.retries).flatMap(([name, policy]: JsonEntry) =>
    isObject(policy) ? retryPolicyRefusals(policy, pointerTo('/use/retries', name)) : [],
  );
  const timeouts = entriesOf(components.timeouts).flatMap(([name, timeout]: JsonEntry) =>
    isObject(timeout) ? durationRefusals(field(timeout, 'after'), `${pointerTo('/use/timeouts', name)}/after`) : [],
  );
  const errors = entriesOf(components.errors).flatMap(([name, error]: JsonEntry) =>
    templateRefusals(error, pointerTo('/use/errors', name)),
  );
  return refused.concat(retries, timeouts, errors);
}

function workflowDataRefusals(document: JsonObject): readonly Refusal[] {
  const input = objectField(document, 'input') ?? {};
  const output = objectField(document, 'output') ?? {};
  return transformRefusals(field(input, 'from'), '/input/from').concat(
    transformRefusals(field(output, 'as'), '/output/as'),
    schemaRefusals(objectField(input, 'schema'), '/input/schema'),
    schemaRefusals(objectField(output, 'schema'), '/output/schema'),
  );
}

function schemaRefusals(schema: JsonObject | undefined, pointer: string): readonly Refusal[] {
  if (schema === undefined) {
    return [];
  }
  if (field(schema, 'resource') !== undefined) {
    return [forbidden(`${pointer}/resource`, 'External schemas are not fetched: write the schema inline as document')];
  }
  const format = textField(schema, 'format') ?? 'json';
  return format === 'json' || format.startsWith('json:')
    ? []
    : [forbidden(`${pointer}/format`, `Schemas are JSON Schema in this version, not ${format}`)];
}

function taskListRefusals(list: Json | undefined, pointer: string, components: Components): readonly Refusal[] {
  const entries = taskEntries(list, pointer);
  const names = new Set(entries.map(({ name }) => name));
  return entries.flatMap((entry) =>
    taskRefusals(entry, components).concat(jumpRefusals(field(entry.task, 'then'), `${entry.reference}/then`, names)),
  );
}

function taskRefusals(entry: TaskEntry, components: Components): readonly Refusal[] {
  return ownRefusals(entry, components).concat(commonRefusals(entry, components), nestedRefusals(entry, components));
}

function jumpRefusals(then: Json | undefined, pointer: string, siblings: ReadonlySet<string>): readonly Refusal[] {
  return typeof then !== 'string' || flowDirectives.has(then) || siblings.has(then)
    ? []
    : [refusal(pointer, `then: ${then} names no task in the same list`)];
}

function nestedRefusals({ task, reference }: TaskEntry, components: Components): readonly Refusal[] {
  const kind = kindOf(task);
  if (kind === 'fork') {
    const branches = field(objectField(task, 'fork') ?? {}, 'branches');
    const pointer = `${reference}/fork/branches`;
    return taskEntries(branches, pointer).flatMap((branch) =>
      taskRefusals(branch, components).concat(
        branchJumpRefusals(field(branch.task, 'then'), `${branch.reference}/then`),
      ),
    );
  }
  const lists: readonly Located[] = [
    [kind === 'do' || kind === 'for' ? field(task, 'do') : undefined, `${reference}/do`],
    [kind === 'try' ? field(task, 'try') : undefined, `${reference}/try`],
    [kind === 'try' ? field(objectField(task, 'catch') ?? {}, 'do') : undefined, `${reference}/catch/do`],
  ];
  return lists.flatMap(([list, pointer]: Located) => taskListRefusals(list, pointer, components));
}

function branchJumpRefusals(then: Json | undefined, pointer: string): readonly Refusal[] {
  return typeof then === 'string' && !flowDirectives.has(then)
    ? [refusal(pointer, 'A branch of a fork cannot jump to another task')]
    : [];
}
