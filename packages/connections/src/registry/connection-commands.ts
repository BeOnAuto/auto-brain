import type { ConnectionEntry, ConnectionKind } from './connection-entry.ts';
import type { Credential } from './credential.ts';
import type { OpenLink } from './registry.ts';

export interface ConnectionAddition {
  readonly type: 'add';
  readonly connection: string;
  readonly name: string;
  readonly kind: ConnectionKind;
  readonly entry: ConnectionEntry;
  readonly credential: Credential;
  readonly link: OpenLink;
}

export interface LinkUse {
  readonly connection: string;
  readonly token_sha256: string;
  readonly bindsPerson: boolean;
}

export interface ConnectionApproval extends LinkUse {
  readonly type: 'approve';
}

export interface CredentialGiving extends LinkUse {
  readonly type: 'give';
  readonly secret_id: string;
  readonly algorithm?: string;
}

export interface ConnectionRemoval {
  readonly type: 'remove';
  readonly connection: string;
}

export type ConnectionCommandData = ConnectionAddition | ConnectionApproval | CredentialGiving | ConnectionRemoval;

export interface CommandMetadata {
  readonly by: string;
  readonly at: string;
}

export type ConnectionCommand = ConnectionCommandData & CommandMetadata;
