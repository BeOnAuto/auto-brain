import { declaredShape, outputShapeNamed, shapeMismatchOf, type OutputShape } from '@on.auto/definitions';
import {
  entriesOf,
  field,
  objectField,
  rejection,
  textField,
  type Json,
  type JsonEntry,
  type JsonObject,
  type Rejection,
} from '@on.auto/workflow-engine';
import { Result } from 'effect';

function outputOf(document: JsonObject): JsonObject {
  return objectField(document, 'output') ?? {};
}

export function outputShapeOf(document: JsonObject): OutputShape | undefined {
  const name = textField(outputOf(document), 'shape');
  return name === undefined ? undefined : outputShapeNamed(name);
}

export function outputShapeRejections(document: JsonObject): readonly Rejection[] {
  const output = outputOf(document);
  const shape = field(output, 'shape');
  if (shape === undefined) {
    return [];
  }
  const declared = declaredShape(shape, field(output, 'schema') !== undefined);
  return Result.isFailure(declared) ? [rejection(`/output/${declared.failure.at}`, declared.failure.detail)] : [];
}

export function outputRefusalOf(document: JsonObject, output: Json): string | undefined {
  const shape = outputShapeOf(document);
  if (shape === undefined) {
    return undefined;
  }
  const mismatch = shapeMismatchOf(shape, output);
  return mismatch === undefined
    ? undefined
    : `The output of the workflow does not match the shape ${shape.name}: ${mismatch}`;
}

export function withoutOutputShape(document: JsonObject): JsonObject {
  const output = objectField(document, 'output');
  if (output === undefined || field(output, 'shape') === undefined) {
    return document;
  }
  return { ...document, output: Object.fromEntries(entriesOf(output).filter(([key]: JsonEntry) => key !== 'shape')) };
}
