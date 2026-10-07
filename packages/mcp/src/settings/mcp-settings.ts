import type { BrainAddress } from '@beonauto/operations';
import type { Redacted } from 'effect';

import type { ToolReference } from '../names/tool-reference.ts';

export interface SettingProblem {
  readonly setting: string;
  readonly detail: string;
}

export type AuthCredential =
  | { readonly kind: 'client_secret'; readonly client_secret: Redacted.Redacted }
  | { readonly kind: 'private_key'; readonly private_key: Redacted.Redacted; readonly algorithm: string };

export interface AuthSettings {
  readonly issuer: string;
  readonly client_id: string;
  readonly scope: string | null;
  readonly credential: AuthCredential;
}

interface ServedBy {
  readonly name: string;
  readonly org: string;
  readonly brains: readonly string[] | null;
  readonly record_content: boolean;
  readonly request_id: string | null;
  readonly secrets: readonly Redacted.Redacted[];
}

export interface HttpServerSettings extends ServedBy {
  readonly type: 'http';
  readonly url: string;
  readonly headers: ReadonlyMap<string, Redacted.Redacted>;
  readonly auth: AuthSettings | null;
}

export interface StdioServerSettings extends ServedBy {
  readonly type: 'stdio';
  readonly command: string;
  readonly args: readonly string[];
  readonly env: ReadonlyMap<string, Redacted.Redacted>;
}

export type McpServerSettings = HttpServerSettings | StdioServerSettings;

export interface McpSettings {
  readonly servers: readonly McpServerSettings[];
  readonly allowed: readonly ToolReference[] | null;
}

export function servesBrain({ org, brains }: ServedBy, address: BrainAddress) {
  return org === address.org && (brains === null || brains.includes(address.brain));
}

export function isListedFor(server: ServedBy, address: BrainAddress, named: string | undefined): boolean {
  return servesBrain(server, address) && (named === undefined || server.name === named);
}
