import { credentialProblems, substituted, type SettingProblem } from '@on.auto/config';
import { InvalidInput, type Issue } from '@on.auto/operations';
import { checkedEntry, serverNameProblems } from '@on.auto/tool-servers';
import { JsonPointer, Result, Schema } from 'effect';

import type { ConnectionEntry, ConnectionKind } from '../registry/connection-entry.ts';
import type { Credential } from '../registry/credential.ts';
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

const fileOnly =
  'Expected an https URL, or an http URL on a loopback address: a connection reads its document from the network, never from the runtime’s disk';

const asJson = Schema.decodeUnknownSync(Schema.Json);

function issuesOf(problems: readonly SettingProblem[], from: string, to: string): readonly Issue[] {
  return problems.map(({ detail }) => {
    const end = detail.indexOf(': ');
    return { pointer: `${to}${detail.slice(from.length, end)}`, detail: detail.slice(end + 2) };
  });
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

function documentIssues({ kind, entry }: AdditionInput): readonly Issue[] {
  return kind === 'openapi' && entry.document !== undefined && !URL.canParse(entry.document)
    ? [{ pointer: '/entry/document', detail: fileOnly }]
    : [];
}

function servedIssues(input: AdditionInput, { org, providers }: EntryChecking): readonly Issue[] {
  const { name, kind, entry } = input;
  const checked = checkedEntry(name, { ...entry, type: kind, org }, { providers, directory: '.', secrets: [] });
  return Result.isFailure(checked) ? issuesOf(checked.failure, `/${JsonPointer.escapeToken(name)}`, '/entry') : [];
}

export function additionIssuesOf(input: AdditionInput, checking: EntryChecking): readonly Issue[] {
  const named = issuesOf(
    serverNameProblems(input.name, checking.providers),
    `/${JsonPointer.escapeToken(input.name)}`,
    '/name',
  );
  return [
    ...named,
    ...documentIssues(input),
    ...writtenIssues(input.name, input.entry),
    ...(named.length === 0 && documentIssues(input).length === 0 ? servedIssues(input, checking) : []),
    ...credentialIssuesOf(input.credential, input.kind, input.entry),
  ];
}

export function invalidAddition(issues: readonly Issue[]): InvalidInput {
  return new InvalidInput({ detail: 'The connection cannot be added as it is given', issues });
}
