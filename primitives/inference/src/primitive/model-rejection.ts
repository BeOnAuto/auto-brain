import type { RunTools } from '@beonauto/mcp';
import { Conflict, InvalidInput, Unavailable } from '@beonauto/operations';
import { Effect } from 'effect';

import type { FailureIssue } from '../failure/failure-issue.ts';
import type { FinishReason } from '../model/model-result.ts';
import { stoppedEnding, unavailableAfter, type Stopped } from '../tools/tool-endings.ts';

export type SpecRejection = InvalidInput | Unavailable | Conflict;

interface Detailed {
  readonly detail: string;
}

interface RejectedSpec extends Detailed {
  readonly provider_message: string | null;
  readonly issues: readonly FailureIssue[];
}

interface InvalidAnswer extends Detailed {
  readonly provider: string;
  readonly finish_reason: FinishReason;
  readonly issues: readonly FailureIssue[];
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

export function rejections(maxOutputTokens: number, tools?: RunTools) {
  const unavailable = (detail: string, advice = '') => unavailableAfter(tools, detail, advice);
  return {
    cancelled: () => Effect.interrupt,
    spec_invalid: ({ detail, provider_message, issues }: RejectedSpec) => {
      const said = provider_message === null ? '' : `. The provider said: ${provider_message}`;
      return Effect.fail(new Conflict({ detail: `${detail}${listed(issues)}; update the spec${said}` }));
    },
    output_invalid: ({ detail, provider, finish_reason, issues }: InvalidAnswer) =>
      finish_reason === 'length'
        ? Effect.fail(
            new Conflict({
              detail: `${provider} stopped the answer at max_output_tokens (${maxOutputTokens}) before the JSON was complete; raise config.max_output_tokens in the spec`,
            }),
          )
        : unavailable(`${detail}${listed(issues)}`, '; try again'),
    content_refused: ({ detail }: Detailed) =>
      Effect.fail(
        new InvalidInput({
          detail,
          issues: [{ pointer: '', detail: 'The model refused this input under its content policy' }],
        }),
      ),
    rate_limited: ({ detail, retry_after_ms }: Limited) =>
      unavailable(detail, `; try again ${waitFor(retry_after_ms)}`),
    provider_unavailable: ({ detail }: Detailed) => unavailable(detail, '; try again later'),
    timed_out: ({ detail }: Detailed) => unavailable(detail, '; try again later'),
    tools_stopped: (stopped: Stopped) => stoppedEnding(tools, stopped),
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
