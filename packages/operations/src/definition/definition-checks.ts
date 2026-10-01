import { Array as Arr, SchemaAST, type Schema } from 'effect';

import type { Scope } from '../caller/scope.ts';
import { pathParametersOf } from './route.ts';
import {
  fieldOf,
  handlerMembersOf,
  holdsEmptyStruct,
  isClosedObject,
  isRequiredStringField,
  wireMembersOf,
} from './wire-shape.ts';

interface CheckableDefinition {
  readonly name: string;
  readonly route: { readonly path: string };
  readonly inputSchema: Schema.Constraint;
  readonly outputSchema: Schema.Constraint;
}

interface CheckedDefinition {
  readonly pathParameters: readonly string[];
  readonly addressesBrain: boolean;
}

const operationName = /^[a-z][a-z0-9_]{0,63}$/u;

const reservedFieldsByScope: Readonly<Record<Scope, readonly string[]>> = { org: ['org'], brain: ['org', 'brain'] };

function closedObjectMembers(
  name: string,
  role: 'input' | 'output',
  schema: Schema.Constraint,
): readonly SchemaAST.Objects[] {
  const wireMembers = wireMembersOf(schema);
  const members = wireMembers.filter((member) => isClosedObject(member));
  if (members.length !== wireMembers.length) {
    throw new Error(`The ${role} of ${name} must be an object that declares its fields`);
  }
  if (members.some((member) => holdsEmptyStruct(member, []))) {
    throw new Error(`The ${role} of ${name} holds an empty struct, which accepts any value`);
  }
  return members;
}

function requireNoReservedField(name: string, scope: Scope, members: readonly SchemaAST.Objects[]): void {
  const reserved = reservedFieldsByScope[scope].find((field) =>
    members.some((member) => fieldOf(member, field) !== undefined),
  );
  if (reserved !== undefined) {
    throw new Error(`The input of ${name} may not have a field named ${reserved}`);
  }
}

function requireRouteParametersAsFields(
  name: string,
  pathParameters: readonly string[],
  members: readonly SchemaAST.Objects[],
): void {
  const missing = pathParameters.find(
    (parameter) => !members.every((member) => isRequiredStringField(fieldOf(member, parameter))),
  );
  if (missing !== undefined) {
    throw new Error(`The route parameter ${missing} of ${name} must be a required string field of every input`);
  }
}

function requireBrainFromBrainField(
  name: string,
  inputSchema: Schema.Constraint,
  members: readonly SchemaAST.Objects[],
): void {
  const renamed = Arr.zip(handlerMembersOf(inputSchema), members).some(
    ([handlerMember, wireMember]: readonly [SchemaAST.AST, SchemaAST.Objects]) =>
      SchemaAST.isObjects(handlerMember) &&
      fieldOf(handlerMember, 'brain') !== undefined &&
      fieldOf(wireMember, 'brain') === undefined,
  );
  if (renamed) {
    throw new Error(`The input of ${name} must take its brain field from a field named brain`);
  }
}

export function checkedDefinition(
  scope: Scope,
  { name, route, inputSchema, outputSchema }: CheckableDefinition,
): CheckedDefinition {
  if (!operationName.test(name)) {
    throw new Error(`The operation name ${name} is malformed`);
  }
  const pathParameters = pathParametersOf(route.path);
  const inputMembers = closedObjectMembers(name, 'input', inputSchema);
  closedObjectMembers(name, 'output', outputSchema);
  requireNoReservedField(name, scope, inputMembers);
  requireRouteParametersAsFields(name, pathParameters, inputMembers);
  requireBrainFromBrainField(name, inputSchema, inputMembers);
  return {
    pathParameters,
    addressesBrain: inputMembers.some((member) => fieldOf(member, 'brain') !== undefined),
  };
}
