import { BrainIdSchema, OrgIdSchema } from '@beonauto/operations';
import { JsonPointer, Redacted, Result, Schema } from 'effect';

import { isServerName } from '../names/tool-reference.ts';
import { problem } from './json-setting.ts';
import type {
  AuthCredential,
  AuthSettings,
  HttpServerSettings,
  McpServerSettings,
  SettingProblem,
  StdioServerSettings,
} from './mcp-settings.ts';
import type { McpServerEntryFields } from './server-entries.ts';

type Checked<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly problems: readonly SettingProblem[] };

type Transport<S extends McpServerSettings> = S extends McpServerSettings
  ? Omit<S, 'name' | 'org' | 'brains' | 'record_content' | 'request_id' | 'secrets'>
  : never;

type Auth = NonNullable<McpServerEntryFields['auth']>;

export const mcpServersSetting = 'MCP_SERVERS';

const isOrgId = Schema.is(OrgIdSchema);

const isBrainId = Schema.is(BrainIdSchema);

const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

const variableName = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const loopbackHosts: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

const headersOfTheClient: ReadonlySet<string> = new Set([
  'mcp-session-id',
  'mcp-protocol-version',
  'content-type',
  'accept',
  'last-event-id',
]);

const serverKinds = { http: 'an http server', stdio: 'a stdio server' } as const;

const httpFields = ['url', 'headers', 'auth'] as const;

const stdioFields = ['command', 'args', 'env'] as const;

function at(name: string, ...path: readonly string[]): string {
  return [name, ...path].map((segment) => `/${JsonPointer.escapeToken(segment)}`).join('');
}

function accepted<A>(value: A): Checked<A> {
  return { ok: true, value };
}

function rejected<A>(problems: readonly SettingProblem[]): Checked<A> {
  return { ok: false, problems };
}

function refused<A>(name: string, path: readonly string[], detail: string): Checked<A> {
  return rejected([problem(mcpServersSetting, at(name, ...path), detail)]);
}

function problemsOf(...checked: readonly Checked<unknown>[]): readonly SettingProblem[] {
  return checked.flatMap((each) => (each.ok ? [] : each.problems));
}

function secretsOf(values: Readonly<Record<string, string>>): ReadonlyMap<string, Redacted.Redacted> {
  return new Map(Object.entries(values).map(([key, value]: readonly [string, string]) => [key, Redacted.make(value)]));
}

function isWebUrl(url: string): boolean {
  return URL.canParse(url) && ['http:', 'https:'].includes(new URL(url).protocol);
}

function isPinnableIssuer(issuer: string): boolean {
  if (!URL.canParse(issuer)) {
    return false;
  }
  const { protocol, hostname } = new URL(issuer);
  return protocol === 'https:' || (protocol === 'http:' && loopbackHosts.has(hostname));
}

function checkedName(name: string, providers: readonly string[]): Checked<string> {
  if (!isServerName(name)) {
    return refused(
      name,
      [],
      'Expected a name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
    );
  }
  return providers.includes(name)
    ? refused(name, [], 'The name of a model provider or gateway, which a reason function could not tell apart from it')
    : accepted(name);
}

function checkedOrg(name: string, org: string | undefined): Checked<string> {
  if (org === undefined) {
    return refused(name, [], 'Expected the org this server serves');
  }
  return isOrgId(org) ? accepted(org) : refused(name, ['org'], 'Expected an org id');
}

function checkedBrains(name: string, brains: readonly string[] | undefined): Checked<readonly string[] | null> {
  if (brains === undefined) {
    return accepted(null);
  }
  const problems = problemsOf(
    ...brains.map((brain, index) =>
      isBrainId(brain) ? accepted(brain) : refused(name, ['brains', String(index)], 'Expected a brain id'),
    ),
  );
  return problems.length === 0 ? accepted(brains) : rejected(problems);
}

function checkedHeaders(
  name: string,
  headers: Readonly<Record<string, string>>,
): Checked<ReadonlyMap<string, Redacted.Redacted>> {
  const problems = problemsOf(
    ...Object.keys(headers).map((header) => {
      if (!headerName.test(header)) {
        return refused(name, ['headers', header], 'Expected a header name');
      }
      return headersOfTheClient.has(header.toLowerCase())
        ? refused(name, ['headers', header], 'A header the MCP client sets itself')
        : accepted(header);
    }),
  );
  return problems.length === 0 ? accepted(secretsOf(headers)) : rejected(problems);
}

function checkedCredential(name: string, { client_secret, private_key, algorithm }: Auth): Checked<AuthCredential> {
  if (client_secret !== undefined && private_key === undefined && algorithm === undefined) {
    return accepted({ kind: 'client_secret', client_secret: Redacted.make(client_secret) });
  }
  if (private_key !== undefined && algorithm !== undefined && client_secret === undefined) {
    return accepted({ kind: 'private_key', private_key: Redacted.make(private_key), algorithm });
  }
  return refused(name, ['auth'], 'Expected client_secret, or private_key with its algorithm, one of the two');
}

function checkedAuth(name: string, { auth, headers = {} }: McpServerEntryFields): Checked<AuthSettings | null> {
  if (auth === undefined) {
    return accepted(null);
  }
  const issuer = isPinnableIssuer(auth.issuer)
    ? accepted(auth.issuer)
    : refused(name, ['auth', 'issuer'], 'Expected an https URL, or an http URL on a loopback address');
  const alone = Object.keys(headers).some((header) => header.toLowerCase() === 'authorization')
    ? refused(name, ['auth'], 'Set an Authorization header or an auth block, not both')
    : accepted(auth);
  const credential = checkedCredential(name, auth);
  const problems = problemsOf(issuer, alone, credential);
  return credential.ok && problems.length === 0
    ? accepted({
        issuer: auth.issuer,
        client_id: auth.client_id,
        scope: auth.scope ?? null,
        credential: credential.value,
      })
    : rejected(problems);
}

function foreignFieldProblems(name: string, fields: McpServerEntryFields, type: 'http' | 'stdio') {
  const foreign = type === 'http' ? stdioFields : httpFields;
  return foreign
    .filter((field) => fields[field] !== undefined)
    .map((field) => problem(mcpServersSetting, at(name, field), `Not a field of ${serverKinds[type]}`));
}

function httpTransport(
  name: string,
  fields: McpServerEntryFields,
  url: string,
): Checked<Transport<HttpServerSettings>> {
  const checkedUrl = isWebUrl(url) ? accepted(url) : refused(name, ['url'], 'Expected an http or https URL');
  const headers = checkedHeaders(name, fields.headers ?? {});
  const auth = checkedAuth(name, fields);
  const problems = [...foreignFieldProblems(name, fields, 'http'), ...problemsOf(checkedUrl, headers, auth)];
  return headers.ok && auth.ok && problems.length === 0
    ? accepted({ type: 'http', url, headers: headers.value, auth: auth.value })
    : rejected(problems);
}

function stdioTransport(
  name: string,
  fields: McpServerEntryFields,
  command: string,
): Checked<Transport<StdioServerSettings>> {
  const env = fields.env ?? {};
  const problems = [
    ...foreignFieldProblems(name, fields, 'stdio'),
    ...(command.trim() === '' ? problemsOf(refused(name, ['command'], 'Expected a command')) : []),
    ...Object.keys(env).flatMap((variable) =>
      variableName.test(variable)
        ? []
        : problemsOf(refused(name, ['env', variable], 'Expected an environment variable name')),
    ),
  ];
  return problems.length === 0
    ? accepted({ type: 'stdio', command, args: fields.args ?? [], env: secretsOf(env) })
    : rejected(problems);
}

function typeOf({ type, url, command }: McpServerEntryFields): 'http' | 'stdio' | undefined {
  if (type !== undefined) {
    return type;
  }
  if (url === undefined) {
    return command === undefined ? undefined : 'stdio';
  }
  return command === undefined ? 'http' : undefined;
}

function missingTransport<A>(name: string, type: 'http' | 'stdio' | undefined): Checked<A> {
  const needed = { http: 'url', stdio: 'command' } as const;
  return refused(
    name,
    [],
    type === undefined
      ? 'Expected url for an http server or command for a stdio server, one of the two'
      : `Expected ${needed[type]} for ${serverKinds[type]}`,
  );
}

function checkedTransport(name: string, fields: McpServerEntryFields): Checked<Transport<McpServerSettings>> {
  const type = typeOf(fields);
  const { url, command } = fields;
  if (type === 'http' && url !== undefined) {
    return httpTransport(name, fields, url);
  }
  return type === 'stdio' && command !== undefined
    ? stdioTransport(name, fields, command)
    : missingTransport(name, type);
}

export function checkedEntry(
  name: string,
  fields: McpServerEntryFields,
  providers: readonly string[],
  secrets: readonly Redacted.Redacted[],
): Result.Result<McpServerSettings, readonly SettingProblem[]> {
  const named = checkedName(name, providers);
  const org = checkedOrg(name, fields.org);
  const brains = checkedBrains(name, fields.brains);
  const transport = checkedTransport(name, fields);
  if (!org.ok || !brains.ok || !transport.ok) {
    return Result.fail(problemsOf(named, org, brains, transport));
  }
  const problems = problemsOf(named);
  return problems.length > 0
    ? Result.fail(problems)
    : Result.succeed({
        ...transport.value,
        name,
        org: org.value,
        brains: brains.value,
        record_content: fields.record_content ?? false,
        request_id: fields.request_id ?? null,
        secrets,
      });
}
