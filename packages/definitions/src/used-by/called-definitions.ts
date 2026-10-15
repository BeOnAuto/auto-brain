import { Schema } from 'effect';

export const CalledDefinitionSchema = Schema.Struct({
  type: Schema.String,
  name: Schema.String,
  role: Schema.optionalKey(Schema.Literals(['trainer', 'approver'])),
});

export type CalledDefinition = typeof CalledDefinitionSchema.Type;
