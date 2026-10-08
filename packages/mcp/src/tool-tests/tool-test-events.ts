import { Schema, Struct } from 'effect';

import { CallAnsweredSchema, CallStartedSchema } from '../calls/call-facts.ts';

export const toolTestsKind = 'tool-tests';

const ofTheTester = { by: Schema.String, at: Schema.String };

const ToolTestStartedSchema = Schema.Struct({
  type: Schema.Literal('tool_test_started'),
  test_id: Schema.String,
  ...Struct.omit(CallStartedSchema.fields, ['type', 'call_id']),
  ...ofTheTester,
});

const ToolTestAnsweredSchema = Schema.Struct({
  type: Schema.Literal('tool_test_answered'),
  test_id: Schema.String,
  ...Struct.omit(CallAnsweredSchema.fields, ['type']),
  ...ofTheTester,
});

export const ToolTestEventSchema = Schema.Union([ToolTestStartedSchema, ToolTestAnsweredSchema]);

export type ToolTestEvent = typeof ToolTestEventSchema.Type;

export type ToolTestStarted = Extract<ToolTestEvent, { readonly type: 'tool_test_started' }>;

export type ToolTestAnswered = Extract<ToolTestEvent, { readonly type: 'tool_test_answered' }>;

export function toolTestStreamOf(testId: string): string {
  return `${toolTestsKind}/${testId}`;
}
