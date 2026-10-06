import { Data, Schema } from 'effect';

export const UnavailableKindSchema = Schema.Literals([
  'model_not_offered',
  'tool_not_offered',
  'mcp_server_failed',
  'tools_unfinished',
  'rebuilding',
]);

export type UnavailableKind = typeof UnavailableKindSchema.Type;

export const UnavailableBecauseSchema = Schema.Literals([
  'provider_not_configured',
  'model_not_allowed',
  'mcp_server_not_configured',
  'tool_not_allowed',
  'tool_not_listed',
  'failing',
  'rate_limited',
  'unreachable',
  'server_failed',
  'model_unavailable',
  'run_bound',
  'no_answer',
]);

export type UnavailableBecause = typeof UnavailableBecauseSchema.Type;

export class Unavailable extends Data.TaggedError('unavailable')<{
  readonly detail: string;
  readonly kind?: UnavailableKind;
  readonly because?: UnavailableBecause;
  readonly record?: Schema.JsonObject;
}> {}
