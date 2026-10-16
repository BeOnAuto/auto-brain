import { credentialProblems, substituted, type SettingProblem } from '@on.auto/config';
import { Conflict, InvalidInput, type Issue } from '@on.auto/operations';
import { isPinnableUrl, pinnedUrlShape, serverNameProblems, takenByTheConfiguration } from '@on.auto/tool-servers';
import { JsonPointer, Redacted, Result, Schema } from 'effect';

import type { ConnectionEntry, ConnectionKind } from '../registry/connection-entry.ts';
import type { Credential } from '../registry/credential.ts';
import { placedCredential, readPlaced, type GivenValue } from '../serving/placed-credentials.ts';
import { credentialIssuesOf } from './credential-checks.ts';

export interface AdditionInput {
  readonly name: string;
  readonly kind: ConnectionKind;
  readonly entry: ConnectionEntry;
  readonly credential: Credential;
}

export interface EntryChecking {
  readonly org: string;
  readonly providers: readonly string[];
}

const heldCredential =
  "Looks like a credential, which a connection's entry never holds: the person gives it on the page the link opens";

const heldReference =
  "Holds a reference to an environment variable, which a connection's entry never holds: a reference credential names the variable";

const fileOnly = `${pinnedUrlShape}: a connection reads its document from the network, never from the runtime’s disk`;

const anyValue: GivenValue = { value: Redacted.make('a value the person gives'), algorithm: undefined };

const asJson = Schema.decodeUnknownSync(Schema.Json);

function issuesOf(problems: readonly SettingProblem[], from: string, to: string): readonly Issue[] {
  return problems.map(({ pointer = '', detail }) => ({ pointer: `${to}${pointer.slice(from.length)}`, detail }));
}

function placed(pointers: readonly string[], detail: string): readonly Issue[] {
  return [...new Set(pointers)].map((pointer) => ({ pointer, detail }));
}

function writtenIssues(name: string, entry: ConnectionEntry): readonly Issue[] {
  const written = asJson(entry);
  const resolved = substituted(written, '/entry', {});
  return [
    ...placed(
      credentialProblems(name, written, '/entry').map(({ pointer }) => pointer),
      heldCredential,
    ),
    ...placed(
      [...resolved.problems, ...resolved.references].map(({ pointer }) => pointer),
      heldReference,
    ),
  ];
}

function addressIssues({ kind, entry }: AdditionInput): readonly Issue[] {
  if (kind === 'mcp') {
    return entry.url === undefined || isPinnableUrl(entry.url)
      ? []
      : [{ pointer: '/entry/url', detail: pinnedUrlShape }];
  }
  return entry.document !== undefined && !URL.canParse(entry.document)
    ? [{ pointer: '/entry/document', detail: fileOnly }]
    : [];
}

function servedIssues(input: AdditionInput, checking: EntryChecking): readonly Issue[] {
  const { name, credential } = input;
  const given = credential.kind === 'none' ? undefined : anyValue;
  const read = readPlaced(input, placedCredential(input.entry, credential, given), checking);
  return Result.isFailure(read) ? issuesOf(read.failure, `/${JsonPointer.escapeToken(name)}`, '/entry') : [];
}

export function additionIssuesOf(input: AdditionInput, checking: EntryChecking): readonly Issue[] {
  const named = issuesOf(
    serverNameProblems(input.name, checking.providers),
    `/${JsonPointer.escapeToken(input.name)}`,
    '/name',
  );
  const unread = [
    ...named,
    ...addressIssues(input),
    ...writtenIssues(input.name, input.entry),
    ...credentialIssuesOf(input.credential, input.kind, input.entry),
  ];
  return unread.length === 0 ? servedIssues(input, checking) : unread;
}

export function invalidAddition(issues: readonly Issue[]): InvalidInput {
  return new InvalidInput({ detail: 'The connection cannot be added as it is given', issues });
}

export function takenByTheFile(name: string): Conflict {
  return new Conflict({ detail: takenByTheConfiguration(name), kind: 'taken' });
}
