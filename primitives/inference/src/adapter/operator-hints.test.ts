import { describe, expect, it } from 'vitest';

import { accessFor, failed, textRequest } from '../testing/adapter-harness.ts';
import { recordingHints } from '../testing/provider-errors.ts';
import { openAiResponse } from '../testing/provider-replies.ts';
import { connectionFailure, jsonResponse, recordingFetch } from '../testing/recording-fetch.ts';

describe('a provider certificate this server does not trust', () => {
  it('tells the caller that its operator must act, and the operator which setting to use', async () => {
    const recording = recordingHints();
    const fetch = recordingFetch(() => connectionFailure('SELF_SIGNED_CERT_IN_CHAIN')).fetch;
    const access = await accessFor({ OPENAI_API_KEY: 'k' }, { fetch, reportOperatorHint: recording.report });

    const failure = await failed(access, textRequest('openai/gpt-5', { execution_id: 'exec-1' }));

    expect(failure.detail).toBe(
      'The TLS certificate of openai is not trusted by this server; its operator must add the certificate authority',
    );
    expect(recording.hints()).toEqual([
      {
        provider: 'openai',
        model: 'openai/gpt-5',
        hint: 'The TLS certificate of openai is not trusted; add its certificate authority with NODE_EXTRA_CA_CERTS',
        execution_id: 'exec-1',
      },
    ]);
  });
});

describe('a call that fails for another reason', () => {
  it('gives the operator no hint', async () => {
    const recording = recordingHints();
    const fetch = recordingFetch(() => jsonResponse(openAiResponse('unused'), 503)).fetch;
    const access = await accessFor({ OPENAI_API_KEY: 'k' }, { fetch, reportOperatorHint: recording.report });

    await failed(access, textRequest('openai/gpt-5', { retries: 'caller' }));

    expect(recording.hints()).toEqual([]);
  });
});
