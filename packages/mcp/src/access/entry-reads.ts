import type { BrainAddress, RecordedContent } from '@beonauto/operations';
import { Effect, Function, Result } from 'effect';

import { secretsOfServers } from '../bounds/secrets.ts';
import { recordingOf, startedFields, type KeepIn, type StartedFields } from '../calls/recorded-calls.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { OneCall } from '../one-call/one-call.ts';
import type { McpServerSettings } from '../settings/mcp-settings.ts';
import { namedLinks } from './tool-naming.ts';
import type { ToolNotOffered } from './tool-not-offered.ts';

export type NamingCheck = (
  address: BrainAddress,
  references: readonly ToolReference[],
) => Result.Result<void, ToolNotOffered>;

export type StartOf = (call: Pick<OneCall, 'org' | 'brain' | 'reference' | 'input'>) => Effect.Effect<StartedFields>;

export function namingOf(servers: readonly McpServerSettings[]): NamingCheck {
  const entries = new Map(servers.map((settings) => [settings.name, { settings }]));
  return (address, references) => Result.map(namedLinks(address, { references, links: entries }), Function.constVoid);
}

export type ContentStore = Pick<RecordedContent, 'put'>;

export function keepingIn(content: ContentStore): KeepIn {
  return ({ org, brain }) =>
    (sha256, text) =>
      Effect.runPromise(content.put({ org, brain }, sha256, text));
}

const nothingKept: Pick<McpServerSettings, 'record_content' | 'request_id'> = {
  record_content: false,
  request_id: null,
};

export function startsOf(servers: readonly McpServerSettings[], keepIn: KeepIn): StartOf {
  const secrets = secretsOfServers(servers);
  return ({ org, brain, reference, input }) => {
    const entry = servers.find(({ name }) => name === reference.server) ?? nothingKept;
    const recording = recordingOf({ ...entry, request_id: null }, secrets, keepIn({ org, brain }));
    return Effect.promise(() => startedFields({ ...reference, input }, recording));
  };
}
