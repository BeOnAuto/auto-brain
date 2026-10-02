import { JsonPointer, Option, Result, type Schema } from 'effect';

import { parseModelReference } from '../model/model-reference.ts';
import type { GenerationSettings } from '../model/model-request.ts';
import { optionCheckFor, providerNamespaces } from '../model/offered-provider-options.ts';
import { requestIssues } from '../model/request-checks.ts';
import { issueAt, type DocumentIssue, type SourceLines } from './document-issue.ts';
import type { ConfigSection } from './front-matter-schema.ts';

type ProviderOptions = Readonly<Record<string, Schema.JsonObject>>;

const defaultOutputTokens = 1024;

export const mostOutputTokens = 64_000;

const settingsPointer = /^\/settings/u;

const gatewayNamespace = /^[a-z][a-zA-Z0-9-]{0,31}$/u;

const namespaces = `provider_options takes ${providerNamespaces.join(', ')}, or the name of a gateway`;

export function modelOf(model: string, lines: SourceLines): Result.Result<string, readonly DocumentIssue[]> {
  return Option.isNone(parseModelReference(model))
    ? Result.fail([issueAt(lines, '/model', 'Expected provider/model, for example anthropic/claude-sonnet-4-5')])
    : Result.succeed(model);
}

export function settingsOf(
  config: ConfigSection,
  lines: SourceLines,
): Result.Result<GenerationSettings, readonly DocumentIssue[]> {
  const { max_output_tokens = defaultOutputTokens, ...others } = config ?? {};
  const settings = { max_output_tokens, ...others };
  const issues = [
    ...requestIssues({
      model: '',
      messages: [{ role: 'user', content: [{ type: 'text', text: '' }] }],
      output: { type: 'text' },
      settings,
    }).map(({ pointer, detail }) => issueAt(lines, pointer.replace(settingsPointer, '/config'), detail)),
    ...(max_output_tokens > mostOutputTokens
      ? [issueAt(lines, '/config/max_output_tokens', `Expected at most ${mostOutputTokens}`)]
      : []),
  ];
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(settings);
}

function pointerOf(path: readonly string[]): string {
  return `/provider_options${path.map((token) => `/${JsonPointer.escapeToken(token)}`).join('')}`;
}

function namespaceIssues(namespace: string, values: Schema.JsonObject, lines: SourceLines): readonly DocumentIssue[] {
  const check = optionCheckFor(namespace);
  if (check === undefined) {
    return gatewayNamespace.test(namespace)
      ? []
      : [issueAt(lines, pointerOf([namespace]), `${namespace} is not a provider namespace: ${namespaces}`)];
  }
  return Object.entries(values).flatMap(([option, value]: readonly [string, Schema.Json]) =>
    check(option, value).map(({ path, detail }) => issueAt(lines, pointerOf([namespace, ...path]), detail)),
  );
}

export function providerOptionsOf(
  options: ProviderOptions | undefined,
  lines: SourceLines,
): Result.Result<ProviderOptions | undefined, readonly DocumentIssue[]> {
  const issues = Object.entries(options ?? {}).flatMap(([namespace, values]: readonly [string, Schema.JsonObject]) =>
    namespaceIssues(namespace, values, lines),
  );
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(options);
}
