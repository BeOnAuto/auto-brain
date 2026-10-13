import { JsonPointer, Predicate, Result, type Schema } from 'effect';

import type {
  ApiDocument,
  DocumentProblem,
  Operation,
  Parameter,
  ParameterOrReference,
  PathItem,
  RequestBody,
  RequestBodyOrReference,
} from './api-document.ts';

export interface Placed<A> {
  readonly value: A;
  readonly pointer: string;
}

export interface JsonBody {
  readonly mediaType: string;
  readonly required: boolean;
  readonly schema: Schema.Json;
  readonly pointer: string;
}

export type BodyOf =
  | { readonly kind: 'none' }
  | { readonly kind: 'json'; readonly body: JsonBody }
  | { readonly kind: 'other'; readonly mediaType: string };

type Resolved<A> = Result.Result<A, readonly DocumentProblem[]>;

const mostReferenceHops = 8;

const jsonMediaType = /^application\/(?:[\w.-]+\+)?json$/u;

function componentOf<A>(
  reference: string,
  kind: 'parameters' | 'requestBodies',
  entries: Readonly<Record<string, A>> | undefined,
): A | undefined {
  const prefix = `#/components/${kind}/`;
  const name = reference.startsWith(prefix) ? JsonPointer.unescapeToken(reference.slice(prefix.length)) : undefined;
  return name === undefined || entries === undefined || !Object.hasOwn(entries, name) ? undefined : entries[name];
}

interface Reference {
  readonly $ref: string;
}

function isReference(value: object): value is Reference {
  return Predicate.hasProperty(value, '$ref') && typeof value.$ref === 'string';
}

function followed<A extends object>(
  written: A | Reference,
  pointer: string,
  lookUp: (reference: string) => A | Reference | undefined,
): Resolved<Placed<A>> {
  let current: A | Reference = written;
  let at = pointer;
  for (let hops = 0; hops <= mostReferenceHops; hops += 1) {
    if (!isReference(current)) {
      return Result.succeed({ value: current, pointer: at });
    }
    const next = lookUp(current.$ref);
    if (next === undefined) {
      return Result.fail([{ pointer: `${at}/$ref`, detail: 'A reference to a component the document does not have' }]);
    }
    at = current.$ref.slice(1);
    current = next;
  }
  return Result.fail([{ pointer, detail: `A reference that leads through more than ${mostReferenceHops} others` }]);
}

function parameterAt(
  document: ApiDocument,
  written: ParameterOrReference,
  pointer: string,
): Resolved<Placed<Parameter>> {
  return followed(written, pointer, (reference) =>
    componentOf(reference, 'parameters', document.components?.parameters),
  );
}

export function collected<I, A>(items: readonly I[], resolve: (item: I) => Resolved<A>): Resolved<readonly A[]> {
  const problems: DocumentProblem[] = [];
  const values: A[] = [];
  for (const item of items) {
    const resolved = resolve(item);
    if (Result.isFailure(resolved)) {
      problems.push(...resolved.failure);
    } else {
      values.push(resolved.success);
    }
  }
  return problems.length > 0 ? Result.fail(problems) : Result.succeed(values);
}

export function parametersOf(
  document: ApiDocument,
  item: Placed<PathItem>,
  operation: Placed<Operation>,
): Resolved<readonly Placed<Parameter>[]> {
  const shared: readonly Placed<ParameterOrReference>[] = (item.value.parameters ?? []).map((value, index) => ({
    value,
    pointer: `${item.pointer}/parameters/${index}`,
  }));
  const own: readonly Placed<ParameterOrReference>[] = (operation.value.parameters ?? []).map((value, index) => ({
    value,
    pointer: `${operation.pointer}/parameters/${index}`,
  }));
  const resolved = collected([...shared, ...own], ({ value, pointer }) => parameterAt(document, value, pointer));
  return Result.map(resolved, (parameters) => {
    const byPlace = new Map(parameters.map((each) => [`${each.value.in}\u0000${each.value.name}`, each]));
    return [...byPlace.values()];
  });
}

function bodyIn(body: Placed<RequestBody>): BodyOf {
  const entries = Object.entries(body.value.content);
  const json = entries.find(([mediaType]: readonly [string, unknown]) =>
    jsonMediaType.test(mediaType.split(';', 1).join('').trim().toLowerCase()),
  );
  if (json !== undefined) {
    const [mediaType, { schema = {} }] = json;
    const pointer = `${body.pointer}/content/${JsonPointer.escapeToken(mediaType)}/schema`;
    return { kind: 'json', body: { mediaType, required: body.value.required === true, schema, pointer } };
  }
  const other = entries.map(([mediaType]: readonly [string, unknown]) => mediaType).at(0);
  return other === undefined ? { kind: 'none' } : { kind: 'other', mediaType: other };
}

export function bodyOf(document: ApiDocument, operation: Placed<Operation>): Resolved<BodyOf> {
  const written: RequestBodyOrReference | undefined = operation.value.requestBody;
  if (written === undefined) {
    return Result.succeed({ kind: 'none' });
  }
  return Result.map(
    followed(written, `${operation.pointer}/requestBody`, (reference) =>
      componentOf(reference, 'requestBodies', document.components?.requestBodies),
    ),
    bodyIn,
  );
}
