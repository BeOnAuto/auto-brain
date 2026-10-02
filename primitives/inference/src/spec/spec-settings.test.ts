import { describe, expect, it } from 'vitest';

import { documentOf, issuesIn, parsed } from '../testing/spec-documents.ts';

describe('the model of a spec', () => {
  it('is written provider/model', () => {
    expect(parsed(documentOf('model: bedrock/arn:aws:bedrock:eu-central-1:1:inference-profile/x')).model).toBe(
      'bedrock/arn:aws:bedrock:eu-central-1:1:inference-profile/x',
    );
    expect(issuesIn(documentOf('model: gpt-5'))).toEqual([
      'Line 2, /model: Expected provider/model, for example anthropic/claude-sonnet-4-5',
    ]);
    expect(issuesIn(documentOf('model: openai/'))).toHaveLength(1);
  });
});

describe('the settings of a spec', () => {
  it('default to 1024 output tokens', () => {
    expect(parsed(documentOf('model: openai/gpt-5\nconfig: {temperature: 0}')).settings).toEqual({
      max_output_tokens: 1024,
      temperature: 0,
    });
  });

  it('take at most 64000 output tokens, as a whole number of 1 or more', () => {
    expect(parsed(documentOf('model: openai/gpt-5\nconfig: {max_output_tokens: 64000}')).settings).toEqual({
      max_output_tokens: 64_000,
    });
    expect(issuesIn(documentOf('model: openai/gpt-5\nconfig:\n  max_output_tokens: 64001'))).toEqual([
      'Line 4, /config/max_output_tokens: Expected at most 64000',
    ]);
    expect(issuesIn(documentOf('model: openai/gpt-5\nconfig:\n  max_output_tokens: 0.5'))).toEqual([
      'Line 4, /config/max_output_tokens: Expected an integer of 1 or more',
    ]);
  });

  it('take a seed that is a whole number of 0 or more', () => {
    expect(issuesIn(documentOf('model: openai/gpt-5\nconfig:\n  seed: -1'))).toEqual([
      'Line 4, /config/seed: Expected an integer of 0 or more',
    ]);
  });
});

const closedOptions = [
  'provider_options:',
  '  anthropic:',
  '    sendReasoning: false',
  '    anthropicBeta: [interleaved-thinking-2025-05-14]',
  '    mcpServers: [{type: url, name: crm, url: "https://crm.example/mcp", authorizationToken: token}]',
  '    fallbacks: [{model: claude-opus-4-1, max_tokens: 64000}]',
  '  bedrock:',
  '    additionalModelRequestFields: {top_k: 5}',
  '    inferenceConfig: {maxTokens: 200000}',
  '    reasoningConfig: {type: enabled, budgetTokens: 2048}',
  '  amazonBedrock:',
  '    anthropicBeta: [context-1m-2025-08-07]',
  '  googleVertex:',
  '    mcpServers: []',
  '    requestType: shared',
  '  vertex:',
  '    sharedRequestType: priority',
  '  google:',
  '    thinkingConfig: {thinkingBudget: 0}',
  '    sharedRequestType: flex',
].join('\n');

const betas = 'anthropicBeta is not accepted: it turns on beta features of the provider through a request header';

const passedThrough =
  'is not accepted: Bedrock adds the keys of this namespace it does not read to the request as they are; it takes reasoningConfig, serviceTier and structuredOutputMode, and the anthropic namespace takes the options of Anthropic models';

const servers =
  'mcpServers is not accepted: it makes the provider connect to other servers, with credentials of their own';

const capacity =
  'is not accepted: it sets a request header that chooses the capacity, and the price, the request is served at';

describe('the provider options of a spec', () => {
  it('are passed on when they only tune the call', () => {
    expect(
      parsed(documentOf('model: anthropic/claude-sonnet-4-5\nprovider_options:\n  anthropic: {sendReasoning: false}'))
        .provider_options,
    ).toEqual({ anthropic: { sendReasoning: false } });
  });

  it('may not set headers, reach other servers or models, or add fields of their own', () => {
    expect(issuesIn(documentOf(`model: anthropic/claude-sonnet-4-5\n${closedOptions}`))).toEqual([
      `Line 6, /provider_options/anthropic/anthropicBeta: ${betas}`,
      `Line 7, /provider_options/anthropic/mcpServers: ${servers}`,
      'Line 8, /provider_options/anthropic/fallbacks: fallbacks is not accepted: it sends the request on to other models, with settings of their own',
      `Line 10, /provider_options/bedrock/additionalModelRequestFields: additionalModelRequestFields ${passedThrough}`,
      `Line 11, /provider_options/bedrock/inferenceConfig: inferenceConfig ${passedThrough}`,
      `Line 14, /provider_options/amazonBedrock/anthropicBeta: anthropicBeta ${passedThrough}`,
      `Line 16, /provider_options/googleVertex/mcpServers: ${servers}`,
      `Line 17, /provider_options/googleVertex/requestType: requestType ${capacity}`,
      `Line 19, /provider_options/vertex/sharedRequestType: sharedRequestType ${capacity}`,
      `Line 22, /provider_options/google/sharedRequestType: sharedRequestType ${capacity}`,
    ]);
  });
});
