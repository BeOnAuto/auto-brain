import { Conflict } from '@beonauto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { accessFor } from '../testing/adapter-harness.ts';
import { exposedText } from '../testing/exposure.ts';
import { gatewayError, gatewayErrorText, gatewayInternals, recordingReporter } from '../testing/provider-errors.ts';
import { execution } from '../testing/reasoning-runs.ts';
import { jsonResponse, recordingFetch } from '../testing/recording-fetch.ts';
import { documentOf } from '../testing/spec-documents.ts';
import { makeReasoningFunctionAdapter } from './reasoning-function.ts';

async function executedThroughGateway(gateway: object) {
  const reporter = recordingReporter();
  const access = await accessFor(
    { MODEL_GATEWAYS: JSON.stringify([gateway]) },
    { fetch: recordingFetch(() => jsonResponse(gatewayError, 404)).fetch, reportProviderMessage: reporter.report },
  );
  const primitive = makeReasoningFunctionAdapter({ languageModel: access.languageModel, offered: access.offered });
  const prepared = Effect.runSync(primitive.prepare(documentOf('model: gateway/no-such-model-xyz', 'Say hello.')));
  const exit = await Effect.runPromiseExit(prepared.execute({}, execution));
  return { exit, reports: reporter.reports() };
}

const gateway = { name: 'gateway', base_url: 'https://llm.internal.example/v1' };

describe('an execution whose gateway rejects the spec', () => {
  it('is a conflict built only from the provider, the status and what the status means', async () => {
    const { exit, reports } = await executedThroughGateway(gateway);

    expect(exit).toEqual(
      Exit.fail(
        new Conflict({
          detail: 'gateway answered HTTP 404: the model was not found; update the reasoning function definition',
        }),
      ),
    );
    expect(gatewayInternals.filter((internal) => exposedText(exit).includes(internal))).toEqual([]);
    expect(reports).toEqual([
      {
        provider: 'gateway',
        model: 'gateway/no-such-model-xyz',
        status: 404,
        message: gatewayErrorText,
        execution_id: execution.id,
      },
    ]);
  });

  it('carries what the gateway said when the operator exposes its messages', async () => {
    const { exit } = await executedThroughGateway({ ...gateway, expose_provider_messages: true });

    expect(exit).toEqual(
      Exit.fail(
        new Conflict({
          detail: `gateway answered HTTP 404: the model was not found; update the reasoning function definition. The provider said: ${gatewayErrorText.slice(0, 300)}`,
        }),
      ),
    );
  });
});
