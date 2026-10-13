import { JsonPointer, type Schema } from 'effect';

import type { Method, Parameter } from './api-document.ts';
import type { BodyOf, Placed } from './api-parameters.ts';
import type { Components } from './input-schemas.ts';
import { isSchemaObject } from './schema-translation.ts';

const mostReferenceHops = 8;

const componentReference = '#/components/schemas/';

function componentAt(reference: string, components: Components): Schema.Json | undefined {
  if (!reference.startsWith(componentReference)) {
    return undefined;
  }
  const name = JsonPointer.unescapeToken(reference.slice(componentReference.length));
  return Object.hasOwn(components.written, name) ? components.written[name] : undefined;
}

function isObjectSchema(schema: Schema.Json | undefined, components: Components): boolean {
  let current = schema;
  for (let hops = 0; hops <= mostReferenceHops && isSchemaObject(current); hops += 1) {
    const reference = current['$ref'];
    if (typeof reference !== 'string') {
      const type = current['type'];
      return type === 'object' || (Array.isArray(type) && type.includes('object'));
    }
    current = componentAt(reference, components);
  }
  return false;
}

function sharedNameOf(names: readonly string[]): string | undefined {
  return names.find((name, index) => names.indexOf(name) < index);
}

function isSentAsWritten({ in: place, style, explode }: Parameter): boolean {
  if (place === 'path') {
    return style === undefined || style === 'simple';
  }
  return place !== 'query' || ((style === undefined || style === 'form') && explode !== false);
}

function methodBecause(method: Method, body: BodyOf): string | undefined {
  if (method === 'trace') {
    return 'a call cannot send TRACE, which fetch refuses';
  }
  return (method === 'get' || method === 'head') && body.kind !== 'none'
    ? `it takes a body, which a ${method.toUpperCase()} cannot carry`
    : undefined;
}

function serializedBecause(sent: readonly Parameter[]): string | undefined {
  const styled = sent.find((each) => !isSentAsWritten(each));
  return styled === undefined
    ? undefined
    : `its ${styled.in} parameter ${styled.name} is written with style ${styled.style ?? 'form'} and explode ${String(styled.explode ?? true)}, a form a call does not send`;
}

export function leftOutBecause(
  method: Method,
  parameters: readonly Placed<Parameter>[],
  body: BodyOf,
  components: Components,
): string | undefined {
  const sent = parameters.map(({ value }) => value);
  const unsendable = methodBecause(method, body) ?? serializedBecause(sent);
  if (unsendable !== undefined) {
    return unsendable;
  }
  const needed = sent.find((each) => (each.in === 'header' || each.in === 'cookie') && each.required === true);
  if (needed !== undefined) {
    return `it needs the ${needed.in} ${needed.name}, which a function cannot send`;
  }
  const objectQuery = sent.find((each) => each.in === 'query' && isObjectSchema(each.schema, components));
  if (objectQuery !== undefined) {
    return `its query parameter ${objectQuery.name} is an object, which a call does not send in a query`;
  }
  if (body.kind === 'other') {
    return `its body is ${body.mediaType}, and a call sends a body only as JSON`;
  }
  const inputs = [
    ...sent.flatMap((each) => (each.in === 'path' || each.in === 'query' ? [each.name] : [])),
    ...(body.kind === 'json' ? ['body'] : []),
  ];
  const shared = sharedNameOf(inputs);
  return shared === undefined ? undefined : `two of its inputs are named ${shared}`;
}
