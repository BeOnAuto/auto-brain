import { CallerIdentitySchema } from '@beonauto/operations';
import { Schema } from 'effect';

const RunAttributesSchema = Schema.Struct({
  org: Schema.String,
  brain: Schema.String,
  execution_id: Schema.String,
  spec: Schema.Struct({ name: Schema.String, version: Schema.Int }),
  caller: CallerIdentitySchema,
  depth: Schema.optionalKey(Schema.Int),
  lineage: Schema.optionalKey(Schema.Struct({ start: Schema.String, correlation: Schema.String })),
});

export type RunAttributes = typeof RunAttributesSchema.Type;

export const attributesOfRun = Schema.decodeUnknownOption(RunAttributesSchema);
