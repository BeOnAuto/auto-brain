import { SchemaAST, type Schema } from 'effect';

import { pathParametersOf } from './route.ts';

interface CheckableDefinition {
  readonly name: string;
  readonly route: { readonly path: string };
  readonly inputSchema: Schema.Constraint;
  readonly outputSchema: Schema.Constraint;
}

interface CheckedDefinition {
  readonly pathParameters: readonly string[];
}

const operationName = /^[a-z][a-z0-9_]{0,63}$/u;

function acceptsUndeclaredKeys({ ast }: Schema.Constraint): boolean {
  return (
    SchemaAST.isObjects(ast) &&
    (ast.indexSignatures.some(({ type }) => !SchemaAST.isNever(type)) ||
      (ast.propertySignatures.length === 0 && ast.indexSignatures.length === 0))
  );
}

function requireClosedRoot(name: string, role: 'input' | 'output', schema: Schema.Constraint): void {
  if (acceptsUndeclaredKeys(schema)) {
    throw new Error(
      `The ${role} of ${name} accepts keys it does not declare; declare its fields, or use Schema.Record(Schema.String, Schema.Never) for none`,
    );
  }
}

export function checkedDefinition({ name, route, inputSchema, outputSchema }: CheckableDefinition): CheckedDefinition {
  if (!operationName.test(name)) {
    throw new Error(`The operation name ${name} is malformed`);
  }
  requireClosedRoot(name, 'input', inputSchema);
  requireClosedRoot(name, 'output', outputSchema);
  return { pathParameters: pathParametersOf(route.path) };
}
