import type { FrontMatterSection, FrontMatterShape } from '@beonauto/definitions/document';
import { Schema } from 'effect';

const descriptionLength = 1000;

const SectionSchema = Schema.Struct({ schema: Schema.optionalKey(Schema.JsonObject) });

const FrontMatterSchema = Schema.Struct({
  description: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(descriptionLength))),
  language: Schema.String,
  input: Schema.optionalKey(SectionSchema),
  output: Schema.optionalKey(SectionSchema),
});

const sections: readonly FrontMatterSection[] = [
  { name: undefined, keys: Object.keys(FrontMatterSchema.fields) },
  { name: 'input', keys: Object.keys(SectionSchema.fields) },
  { name: 'output', keys: Object.keys(SectionSchema.fields) },
];

export const decodeFrontMatter = Schema.decodeUnknownResult(FrontMatterSchema, { errors: 'all' });

export const computationFrontMatter: FrontMatterShape = {
  sections,
  decode: decodeFrontMatter,
  required: 'the language',
};
