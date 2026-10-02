import { JsonPointer, Option, Result, type Schema } from 'effect';

import { parseModelReference } from '../model/model-reference.ts';
import type { GenerationSettings } from '../model/model-request.ts';
import { requestIssues } from '../model/request-checks.ts';
import { issueAt, type DocumentIssue, type SourceLines } from './document-issue.ts';
import type { ConfigSection } from './front-matter-schema.ts';

type ProviderOptions = Readonly<Record<string, Schema.JsonObject>>;

type OptionRule = (option: string) => string | undefined;

const defaultOutputTokens = 1024;

const mostOutputTokens = 64_000;

const settingsPointer = /^\/settings/u;

const betas = 'it turns on beta features of the provider through a request header';
const servers = 'it makes the provider connect to other servers, with credentials of their own';
const fallbacks = 'it sends the request on to other models, with settings of their own';
const capacityHeader = 'it sets a request header that chooses the capacity, and the price, the request is served at';
const bedrockPassThrough =
  'Bedrock adds the keys of this namespace it does not read to the request as they are; it takes reasoningConfig, serviceTier and structuredOutputMode, and the anthropic namespace takes the options of Anthropic models';

const anthropicMessages: readonly (readonly [string, string])[] = [
  ['anthropicBeta', betas],
  ['mcpServers', servers],
  ['fallbacks', fallbacks],
];

const vertexCapacity: readonly (readonly [string, string])[] = [
  ['sharedRequestType', capacityHeader],
  ['requestType', capacityHeader],
];

const bedrockOptions: ReadonlySet<string> = new Set(['reasoningConfig', 'serviceTier', 'structuredOutputMode']);

function closing(closed: readonly (readonly [string, string])[]): OptionRule {
  const reasons = new Map(closed);
  return (option) => reasons.get(option);
}

function bedrockRule(option: string): string | undefined {
  return bedrockOptions.has(option) ? undefined : bedrockPassThrough;
}

const optionRules: ReadonlyMap<string, OptionRule> = new Map([
  ['anthropic', closing(anthropicMessages)],
  ['googleVertex', closing([...anthropicMessages, ...vertexCapacity])],
  ['vertex', closing(vertexCapacity)],
  ['google', closing(vertexCapacity)],
  ['bedrock', bedrockRule],
  ['amazonBedrock', bedrockRule],
]);

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

function closedIn(namespace: string, values: Schema.JsonObject, lines: SourceLines): readonly DocumentIssue[] {
  const rule = optionRules.get(namespace);
  if (rule === undefined) {
    return [];
  }
  return Object.keys(values).flatMap((option) => {
    const reason = rule(option);
    const pointer = `/provider_options/${JsonPointer.escapeToken(namespace)}/${JsonPointer.escapeToken(option)}`;
    return reason === undefined ? [] : [issueAt(lines, pointer, `${option} is not accepted: ${reason}`)];
  });
}

export function providerOptionsOf(
  options: ProviderOptions | undefined,
  lines: SourceLines,
): Result.Result<ProviderOptions | undefined, readonly DocumentIssue[]> {
  const issues = Object.entries(options ?? {}).flatMap(([namespace, values]: readonly [string, Schema.JsonObject]) =>
    closedIn(namespace, values, lines),
  );
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(options);
}
