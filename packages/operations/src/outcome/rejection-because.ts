import { Schema } from 'effect';

export const RejectionBecauseSchema = Schema.Literals([
  'provider_not_configured',
  'model_not_allowed',
  'mcp_server_not_configured',
  'tool_not_allowed',
  'tool_not_listed',
  'not_testable',
  'failing',
  'rate_limited',
  'unreachable',
  'key_refused',
  'server_failed',
  'tool_error',
  'model_unavailable',
  'run_bound',
  'no_answer',
  'only_read',
]);

export type RejectionBecause = typeof RejectionBecauseSchema.Type;
