import { Data } from 'effect';

export type ServerFailedBecause = 'failing' | 'rate_limited' | 'unreachable';

export type CallsEndedBecause = Exclude<ServerFailedBecause, 'unreachable'>;

export class McpServerFailed extends Data.TaggedError('mcp_server_failed')<{
  readonly because: ServerFailedBecause;
  readonly detail: string;
}> {}
