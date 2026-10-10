import type { RunTools } from '@beonauto/mcp';
import { Conflict, InvalidInput, Unavailable } from '@beonauto/operations';
import { Clock, Effect } from 'effect';

import type { FailureIssue } from '../failure/failure-issue.ts';
import type { FinishReason, TokenUsage } from '../model/model-result.ts';
import { stoppedEnding, unavailableAfter, type Spent, type Stopped } from '../tools/tool-endings.ts';
import { spendingRecord } from './spending-record.ts';

export type DefinitionRejection = InvalidInput | Unavailable | Conflict;

interface Detailed {
  readonly detail: string;
}

interface RejectedDefinition extends Detailed {
  readonly provider_message: string | null;
  readonly issues: readonly FailureIssue[];
}

interface Answered extends Detailed {
  readonly usage: TokenUsage | null;
}

interface InvalidAnswer extends Answered {
  readonly provider: string;
  readonly finish_reason: FinishReason;
  readonly issues: readonly FailureIssue[];
}

export type Spending = (usage: TokenUsage | null | undefined) => Effect.Effect<Spent>;

export function spendingSince(started: number): Spending {
  return (usage) =>
    usage === null || usage === undefined
      ? Effect.succeed({})
      : Effect.map(Clock.currentTimeMillis, (now) => ({ record: spendingRecord(usage, now - started) }));
}

interface Limited extends Detailed {
  readonly retry_after_ms: number | null;
}

interface UnconfiguredProvider extends Detailed {
  readonly provider: string;
  readonly configured: readonly string[];
}

const mostIssues = 5;

function listed(issues: readonly FailureIssue[]): string {
  const shown = issues.slice(0, mostIssues).map(({ pointer, detail }) => `${pointer}: ${detail}`);
  return shown.length === 0 ? '' : ` (${shown.join('; ')})`;
}

function othersAreOffered({ provider, configured }: UnconfiguredProvider): boolean {
  return configured.length > 0 && !configured.includes(provider);
}

function waitFor(retryAfterMs: number | null): string {
  if (retryAfterMs === null) {
    return 'later';
  }
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return seconds === 1 ? 'in 1 second' : `in ${seconds} seconds`;
}

const namesTheContext = /context|too long|input token/iu;

const counted = new Intl.NumberFormat('en');

function answeredInWords(tools: RunTools | undefined, providerMessage: string | null): string {
  const answered = tools?.answeredBytes() ?? 0;
  return providerMessage !== null && namesTheContext.test(providerMessage) && answered > 0
    ? `, since the tools of this run answered ${counted.format(answered)} bytes, which the model reads whole, so ask them for a page of what they hold`
    : '';
}

function definitionRefused(tools: RunTools | undefined) {
  return ({ detail, provider_message, issues }: RejectedDefinition): Effect.Effect<never, Conflict> => {
    const said = provider_message === null ? '' : `. The provider said: ${provider_message}`;
    return Effect.fail(
      new Conflict({
        detail: `${detail}${listed(issues)}; update the reasoning function definition${answeredInWords(tools, provider_message)}${said}`,
        kind: 'unworkable',
      }),
    );
  };
}

export function rejections(maxOutputTokens: number, spending: Spending, tools?: RunTools) {
  const unavailable = (detail: string, advice = '', spent: Spent = {}) =>
    unavailableAfter(tools, detail, advice, spent);
  return {
    cancelled: () => Effect.interrupt,
    definition_invalid: definitionRefused(tools),
    output_invalid: ({ detail, provider, finish_reason, issues, usage }: InvalidAnswer) =>
      Effect.flatMap(spending(usage), (spent): Effect.Effect<never, Conflict | Unavailable> =>
        finish_reason === 'length'
          ? Effect.fail(
              new Conflict({
                detail: `${provider} stopped the answer at max_output_tokens (${maxOutputTokens}) before the JSON was complete; raise config.max_output_tokens in the reasoning function definition`,
                kind: 'unworkable',
                ...spent,
              }),
            )
          : unavailable(`${detail}${listed(issues)}`, '; try again', spent),
      ),
    content_refused: ({ detail, usage }: Answered) =>
      Effect.flatMap(spending(usage), (spent) =>
        Effect.fail(
          new InvalidInput({
            detail,
            issues: [{ pointer: '', detail: 'The model refused this input under its content policy' }],
            ...spent,
          }),
        ),
      ),
    rate_limited: ({ detail, retry_after_ms }: Limited) =>
      unavailable(detail, `; try again ${waitFor(retry_after_ms)}`),
    provider_unavailable: ({ detail }: Detailed) => unavailable(detail, '; try again later'),
    timed_out: ({ detail }: Detailed) => unavailable(detail, '; try again later'),
    tools_stopped: (stopped: Stopped) =>
      Effect.flatMap(spending(stopped.usage), (spent) => stoppedEnding(tools, stopped, spent)),
    provider_not_configured: (failure: UnconfiguredProvider) =>
      othersAreOffered(failure)
        ? Effect.fail(
            new Unavailable({ detail: failure.detail, kind: 'model_not_offered', because: 'provider_not_configured' }),
          )
        : unavailable(failure.detail),
    model_not_allowed: ({ detail }: Detailed) =>
      Effect.fail(new Unavailable({ detail, kind: 'model_not_offered', because: 'model_not_allowed' })),
    credentials_rejected: ({ detail }: Detailed) => unavailable(detail),
  };
}
