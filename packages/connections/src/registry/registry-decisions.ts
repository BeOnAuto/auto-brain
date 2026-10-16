import { Conflict, type Context, type Rejection } from '@on.auto/operations';
import { Result } from 'effect';

import type {
  CommandMetadata,
  ConnectionAddition,
  ConnectionApproval,
  ConnectionCommand,
  ConnectionRemoval,
  CredentialGiving,
} from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { keptConnectionOf, linkedConnectionOf } from './registry-lookup.ts';
import type { KeptConnection, Registry } from './registry.ts';

type Decision = Result.Result<readonly ConnectionEvent[], Rejection<'not_found' | 'conflict' | 'forbidden'>>;

const nothingToRecord: Decision = Result.succeed([]);

const kindsGivenOnThePage: ReadonlySet<string> = new Set(['secret', 'client_credentials']);

function takesAValue({ connection }: KeptConnection): boolean {
  return kindsGivenOnThePage.has(connection.credential.kind);
}

export function takesNoCredential(name: string): Conflict {
  return new Conflict({ detail: `The connection ${name} takes no credential to give, so it is approved as it is` });
}

function decideAddition(
  { connection, name, kind, entry, credential, link }: ConnectionAddition,
  registry: Registry,
): Decision {
  const taken = [...registry.values()].some(
    (kept) => kept.connection.name === name && kept.connection.status !== 'removed',
  );
  return taken
    ? Result.fail(new Conflict({ detail: `There is already a connection ${name} in this org`, kind: 'taken' }))
    : Result.succeed([
        { type: 'connection_added', data: { connection, name, kind, entry, credential } },
        { type: 'connection_link_issued', data: { connection, ...link } },
      ]);
}

function decideApproval(command: ConnectionApproval & CommandMetadata, registry: Registry): Decision {
  return Result.flatMap(linkedConnectionOf(registry, command, command), (kept) =>
    takesAValue(kept)
      ? Result.fail(
          new Conflict({
            detail: `The connection ${kept.connection.name} takes a credential, so it is approved by giving its credential`,
          }),
        )
      : Result.succeed([
          { type: 'connection_approved', data: { connection: command.connection } },
          { type: 'connection_connected', data: { connection: command.connection } },
        ]),
  );
}

function decideGiving(command: CredentialGiving & CommandMetadata, registry: Registry): Decision {
  const { connection, secret_id: secretId, algorithm } = command;
  return Result.flatMap(linkedConnectionOf(registry, command, command), (kept) =>
    takesAValue(kept)
      ? Result.succeed([
          { type: 'connection_approved', data: { connection } },
          {
            type: 'connection_connected',
            data: { connection, secret_id: secretId, ...(algorithm === undefined ? {} : { algorithm }) },
          },
        ])
      : Result.fail(takesNoCredential(kept.connection.name)),
  );
}

function decideRemoval({ connection }: ConnectionRemoval, registry: Registry): Decision {
  return Result.flatMap(keptConnectionOf(registry, connection), (kept) =>
    kept.connection.status === 'removed'
      ? nothingToRecord
      : Result.succeed([{ type: 'connection_removed', data: { connection } }]),
  );
}

export function registryContextOf({ by, at }: CommandMetadata): Context {
  return { at, by };
}

export function decideOnRegistry(command: ConnectionCommand, registry: Registry): Decision {
  if (command.type === 'add') {
    return decideAddition(command, registry);
  }
  if (command.type === 'approve') {
    return decideApproval(command, registry);
  }
  if (command.type === 'give') {
    return decideGiving(command, registry);
  }
  return decideRemoval(command, registry);
}
