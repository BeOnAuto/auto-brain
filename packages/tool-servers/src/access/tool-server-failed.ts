import { Data } from 'effect';

export type ServerFailedBecause = 'failing' | 'rate_limited' | 'unreachable' | 'key_refused';

export type CallsEndedBecause = Exclude<ServerFailedBecause, 'unreachable' | 'key_refused'>;

export class ToolServerFailed extends Data.TaggedError('tool_server_failed')<{
  readonly because: ServerFailedBecause;
  readonly detail: string;
}> {}
