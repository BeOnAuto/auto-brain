import { BrainIdSchema } from '@beonauto/operations';
import { Schema, SchemaTransformation } from 'effect';

export const BrainIdField = BrainIdSchema.annotate({
  description: 'The id of the brain: 3 to 48 lowercase letters, digits and hyphens, starting with a letter',
});

export const BrainNameField = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))
  .annotate({
    description: 'The display name of the brain: 1 to 100 characters, not all whitespace',
  })
  .pipe(
    Schema.decodeTo(Schema.Trimmed.check(Schema.isMinLength(1), Schema.isMaxLength(100)), SchemaTransformation.trim()),
  );

export const BrainDescriptionField = Schema.String.check(Schema.isMaxLength(2000))
  .annotate({ description: 'What the brain is for: up to 2000 characters, or empty' })
  .pipe(Schema.decodeTo(Schema.Trimmed.check(Schema.isMaxLength(2000)), SchemaTransformation.trim()));
