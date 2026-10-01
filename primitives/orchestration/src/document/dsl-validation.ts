import { buildGraph, Classes, SchemaValidationError, WorkflowValidationError } from '@openworkflowspec/sdk';

import type { JsonObject } from '../dsl/json.ts';
import { taskKinds } from '../dsl/tasks.ts';

export interface Problem {
  readonly pointer: string;
  readonly detail: string;
}

interface SchemaError {
  readonly instancePath: string;
  readonly keyword: string;
  readonly message?: string;
  readonly params: object;
}

type Deserialized =
  | { readonly workflow: ReturnType<typeof Classes.Workflow.deserialize> }
  | { readonly problems: readonly Problem[] };

const branchKeys = new Set<string>([...taskKinds, 'with']);

const branchKeywords = new Set(['oneOf', 'anyOf', 'const', 'not', 'if']);

export function dslProblems(
  document: JsonObject,
  { connecting }: { readonly connecting: boolean },
): readonly Problem[] {
  const deserialized = deserialize(document);
  if ('problems' in deserialized || !connecting) {
    return 'problems' in deserialized ? deserialized.problems : [];
  }
  try {
    buildGraph(deserialized.workflow);
    return [];
  } catch (error) {
    return [{ pointer: '', detail: `The steps of the workflow do not connect: ${messageOf(error)}` }];
  }
}

function deserialize(document: JsonObject): Deserialized {
  try {
    return { workflow: Classes.Workflow.deserialize(JSON.stringify(document)) };
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      return { problems: schemaProblems(error.schemaErrors) };
    }
    return {
      problems: [
        {
          pointer: error instanceof WorkflowValidationError ? error.path : '',
          detail: messageOf(error).replace(/^.* is invalid - /u, ''),
        },
      ],
    };
  }
}

export function schemaProblems(errors: readonly SchemaError[]): readonly Problem[] {
  const kept = errors.filter((error) => !isBranchNoise(error));
  const deepest = kept.filter(
    (error) => !kept.some((other) => other.instancePath.startsWith(`${error.instancePath}/`)),
  );
  const untyped = [
    ...new Set(errors.filter((error) => missingBranchKey(error)).map(({ instancePath }) => instancePath)),
  ]
    .filter((path) => !kept.some(({ instancePath }) => instancePath === path || instancePath.startsWith(`${path}/`)))
    .map((pointer) => ({
      pointer,
      detail: `The task has no type the DSL knows: a task is one of ${taskKinds.toSorted().join(', ')}`,
    }));
  const described = deepest.map((error) => ({ pointer: error.instancePath, detail: describe(error) }));
  return [...distinct(described), ...untyped];
}

function isBranchNoise(error: SchemaError): boolean {
  return branchKeywords.has(error.keyword) || missingBranchKey(error);
}

function missingBranchKey({ keyword, params }: SchemaError): boolean {
  const missing: unknown = Reflect.get(params, 'missingProperty');
  return keyword === 'required' && typeof missing === 'string' && branchKeys.has(missing);
}

function describe({ keyword, message, params }: SchemaError): string {
  const parameter = (name: string): string => String(Reflect.get(params, name));
  if (keyword === 'required') {
    return `It needs ${parameter('missingProperty')}`;
  }
  if (keyword === 'unevaluatedProperties' || keyword === 'additionalProperties') {
    const property: unknown = Reflect.get(params, 'unevaluatedProperty') ?? Reflect.get(params, 'additionalProperty');
    return `It has ${String(property)}, which the DSL does not know here`;
  }
  return `It ${message ?? `breaks the rule ${keyword}`}`;
}

function distinct(rejections: readonly Problem[]): readonly Problem[] {
  const seen = new Set<string>();
  return rejections.filter(({ pointer, detail }) => {
    const key = `${pointer}\n${detail}`;
    const fresh = !seen.has(key);
    seen.add(key);
    return fresh;
  });
}

function messageOf(error: unknown): string {
  return String(error).replace(/^\w*Error: /u, '');
}
