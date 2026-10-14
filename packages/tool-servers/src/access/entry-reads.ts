import { sha256Of, textToKeep, type PlaybookAddress, type RecordedContent } from '@on.auto/operations';
import { Effect, Function, Result } from 'effect';

import { secretsOfServers } from '../bounds/secrets.ts';
import { recordingOf, startedFields, type KeepIn, type StartedFields } from '../calls/recorded-calls.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { OneCall } from '../one-call/one-call.ts';
import type { ServerSettings } from '../settings/server-settings.ts';
import { namedLinks } from './tool-naming.ts';
import type { ToolNotOffered } from './tool-not-offered.ts';

export type NamingCheck = (
  address: PlaybookAddress,
  references: readonly ToolReference[],
) => Result.Result<void, ToolNotOffered>;

export type StartOf = (call: Pick<OneCall, 'org' | 'playbook' | 'reference' | 'input'>) => Effect.Effect<StartedFields>;

export function namingOf(servers: readonly ServerSettings[]): NamingCheck {
  const entries = new Map(servers.map((settings) => [settings.name, { settings }]));
  return (address, references) => Result.map(namedLinks(address, { references, links: entries }), Function.constVoid);
}

export type ContentStore = Pick<RecordedContent, 'put'>;

export function keepingIn(content: ContentStore): KeepIn {
  return ({ org, playbook }) =>
    (text) =>
      Effect.runPromise(
        content
          .put({ org, playbook }, { ...textToKeep(text, 'application/json'), expected: { sha256: sha256Of(text) } })
          .pipe(
            Effect.map(({ sha256 }) => sha256),
            Effect.orDie,
          ),
      );
}

const nothingKept: Pick<ServerSettings, 'record_content' | 'request_id'> = {
  record_content: false,
  request_id: null,
};

export function startsOf(servers: readonly ServerSettings[], keepIn: KeepIn): StartOf {
  const secrets = secretsOfServers(servers);
  return ({ org, playbook, reference, input }) => {
    const entry = servers.find(({ name }) => name === reference.server) ?? nothingKept;
    const recording = recordingOf({ ...entry, request_id: null }, secrets, keepIn({ org, playbook }));
    return Effect.promise(() => startedFields({ ...reference, input }, recording));
  };
}
