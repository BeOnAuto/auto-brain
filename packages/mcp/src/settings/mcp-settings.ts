import { servesPlaybook } from '@on.auto/config';
import type { Redacted } from 'effect';

export type AuthCredential =
  | { readonly kind: 'client_secret'; readonly client_secret: Redacted.Redacted }
  | { readonly kind: 'private_key'; readonly private_key: Redacted.Redacted; readonly algorithm: string };

export interface AuthSettings {
  readonly issuer: string;
  readonly client_id: string;
  readonly scope: string | null;
  readonly credential: AuthCredential;
}

export interface ToolLists {
  readonly allowed: readonly string[] | null;
  readonly testable: readonly string[];
}

interface ServedBy extends ToolLists {
  readonly name: string;
  readonly org: string;
  readonly playbooks: readonly string[] | null;
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

export type ServerToolLists = Pick<McpServerSettings, 'name' | 'allowed' | 'testable'>;

export interface McpSettings {
  readonly servers: readonly McpServerSettings[];
}

export interface ServersScope {
  readonly org: string;
  readonly playbook: string | undefined;
}

export const everyPlaybook = '*';

function servesScope(server: ServedBy, { org, playbook }: ServersScope): boolean {
  return playbook === undefined ? server.org === org : servesPlaybook(server, { org, playbook });
}

export function isListedFor(server: ServedBy, scope: ServersScope, named: string | undefined): boolean {
  return servesScope(server, scope) && (named === undefined || server.name === named);
}

export function playbooksServedBy(servers: readonly McpServerSettings[], name: string): readonly string[] {
  return servers.filter((server) => server.name === name).flatMap(({ playbooks }) => playbooks ?? [everyPlaybook]);
}
