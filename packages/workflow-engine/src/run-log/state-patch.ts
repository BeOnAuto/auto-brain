import { Schema } from 'effect';

const PointerSchema = Schema.String;

export const PatchOperationSchema = Schema.Union([
  Schema.Struct({ op: Schema.Literal('add'), path: PointerSchema, value: Schema.Json }),
  Schema.Struct({ op: Schema.Literal('replace'), path: PointerSchema, value: Schema.Json }),
  Schema.Struct({ op: Schema.Literal('remove'), path: PointerSchema }),
]);

export type PatchOperation = typeof PatchOperationSchema.Type;

export type StatePatch = readonly PatchOperation[];
