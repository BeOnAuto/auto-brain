import { JsonPointer, Result, type Schema } from 'effect';

import { cutToDescriptionBound } from '../bounds/call-bounds.ts';
import type { ListedTool, ToolAnnotations } from '../bounds/tool-results.ts';
import {
  methods,
  type ApiDocument,
  type DocumentProblem,
  type Method,
  type Operation,
  type Parameter,
  type PathItem,
  type ReadDocument,
} from './api-document.ts';
import { bodyOf, collected, parametersOf, type BodyOf, type JsonBody, type Placed } from './api-parameters.ts';
import { documentBounds } from './document-reading.ts';
import { componentsOf, inputSchemaOf, type Components } from './input-schemas.ts';
import { leftOutBecause } from './left-out.ts';

interface ApiInput {
  readonly name: string;
  readonly in: 'path' | 'query';
}

export interface ApiOperation {
  readonly tool: ListedTool;
  readonly method: Method;
  readonly path: string;
  readonly inputs: readonly ApiInput[];
  readonly body: Pick<JsonBody, 'mediaType' | 'required'> | null;
}

export interface LeftOutOperation {
  readonly operation: string;
  readonly because: string;
}

export interface DerivedTools {
  readonly operations: readonly ApiOperation[];
  readonly leftOut: readonly LeftOutOperation[];
}

interface Located {
  readonly method: Method;
  readonly path: string;
  readonly item: Placed<PathItem>;
  readonly operation: Placed<Operation>;
}

interface Offered {
  readonly operation: ApiOperation;
  readonly pointer: string;
}

type Derived =
  | { readonly kind: 'offered'; readonly offered: Offered }
  | { readonly kind: 'left_out'; readonly leftOut: LeftOutOperation };

type Deriving<A> = Result.Result<A, readonly DocumentProblem[]>;

const outsideToolNames = /[^A-Za-z0-9_.-]/gu;

const mostToolNameCharacters = 128;

const readOnlyMethods: ReadonlySet<Method> = new Set(['get', 'head']);

const idempotentMethods: ReadonlySet<Method> = new Set(['get', 'head', 'put', 'delete']);

function derivedName(method: Method, path: string): string {
  const segments = path
    .replace(/^\//u, '')
    .replaceAll(/\{([^}]*)\}/gu, '$1')
    .replaceAll('/', '_');
  return `${method}_${segments}`.toLowerCase();
}

function toolNameOf({ method, path, operation }: Located): string {
  const given = operation.value.operationId?.trim() ?? '';
  const written = given === '' ? derivedName(method, path) : given;
  return written.replaceAll(outsideToolNames, '_').slice(0, mostToolNameCharacters);
}

function descriptionOf({ summary, description }: Operation): string | undefined {
  const written = [summary, description].flatMap((each) =>
    each === undefined || each.trim() === '' ? [] : [each.trim()],
  );
  return written.length === 0 ? undefined : cutToDescriptionBound(written.join('\n\n'));
}

function annotationsOf(method: Method): ToolAnnotations {
  return {
    ...(readOnlyMethods.has(method) ? { readOnlyHint: true } : {}),
    ...(method === 'delete' ? { destructiveHint: true } : {}),
    ...(idempotentMethods.has(method) ? { idempotentHint: true } : {}),
    openWorldHint: true,
  };
}

function inputsOf(parameters: readonly Placed<Parameter>[]): readonly ApiInput[] {
  return parameters.flatMap(({ value }) =>
    value.in === 'path' || value.in === 'query' ? [{ name: value.name, in: value.in }] : [],
  );
}

function namedOperation({ method, path, operation }: Located): string {
  const route = `${method.toUpperCase()} ${path}`;
  const given = operation.value.operationId;
  return given === undefined ? route : `${given} (${route})`;
}

function offeredOf(
  located: Located,
  inputSchema: Schema.JsonObject,
  parameters: readonly Placed<Parameter>[],
  body: BodyOf,
): Offered {
  const description = descriptionOf(located.operation.value);
  const tool: ListedTool = {
    name: toolNameOf(located),
    ...(description === undefined ? {} : { description }),
    inputSchema,
    annotations: annotationsOf(located.method),
  };
  return {
    operation: {
      tool,
      method: located.method,
      path: located.path,
      inputs: inputsOf(parameters),
      body: body.kind === 'json' ? { mediaType: body.body.mediaType, required: body.body.required } : null,
    },
    pointer: located.operation.pointer,
  };
}

function derivedAt(read: ReadDocument, components: Components, located: Located): Deriving<Derived> {
  const parameters = parametersOf(read.document, located.item, located.operation);
  const body = bodyOf(read.document, located.operation);
  if (Result.isFailure(parameters) || Result.isFailure(body)) {
    return Result.fail([
      ...(Result.isFailure(parameters) ? parameters.failure : []),
      ...(Result.isFailure(body) ? body.failure : []),
    ]);
  }
  const because = leftOutBecause(parameters.success, body.success, components);
  if (because !== undefined) {
    return Result.succeed({ kind: 'left_out', leftOut: { operation: namedOperation(located), because } });
  }
  return Result.map(inputSchemaOf(read.version, components, parameters.success, body.success), (inputSchema) => ({
    kind: 'offered',
    offered: offeredOf(located, inputSchema, parameters.success, body.success),
  }));
}

function locatedIn(document: ApiDocument): readonly Located[] {
  return Object.entries(document.paths ?? {}).flatMap(([path, item]: readonly [string, PathItem]) => {
    const pointer = `/paths/${JsonPointer.escapeToken(path)}`;
    return methods.flatMap((method) => {
      const operation = item[method];
      return operation === undefined
        ? []
        : [
            {
              method,
              path,
              item: { value: item, pointer },
              operation: { value: operation, pointer: `${pointer}/${method}` },
            },
          ];
    });
  });
}

function collisionsOf(offered: readonly Offered[]): readonly DocumentProblem[] {
  const first = new Map<string, string>();
  return offered.flatMap(({ operation, pointer }) => {
    const earlier = first.get(operation.tool.name);
    if (earlier === undefined) {
      first.set(operation.tool.name, pointer);
      return [];
    }
    return [
      {
        pointer,
        detail: `The tool name ${operation.tool.name} is the name of the operation at ${earlier} too; give one of them another operationId`,
      },
    ];
  });
}

function toolsOf(derived: readonly Derived[]): Deriving<DerivedTools> {
  const offered = derived.flatMap((each) => (each.kind === 'offered' ? [each.offered] : []));
  const collisions = collisionsOf(offered);
  return collisions.length > 0
    ? Result.fail(collisions)
    : Result.succeed({
        operations: offered.map(({ operation }) => operation),
        leftOut: derived.flatMap((each) => (each.kind === 'left_out' ? [each.leftOut] : [])),
      });
}

export function derivedTools(read: ReadDocument): Deriving<DerivedTools> {
  const located = locatedIn(read.document);
  if (located.length > documentBounds.operations) {
    return Result.fail([
      {
        pointer: '/paths',
        detail: `The document holds ${located.length} operations, more than the ${documentBounds.operations} a tool server may offer`,
      },
    ]);
  }
  return Result.flatMap(componentsOf(read), (components) => {
    const derived = collected(located, (each) => derivedAt(read, components, each));
    return Result.flatMap(derived, toolsOf);
  });
}
