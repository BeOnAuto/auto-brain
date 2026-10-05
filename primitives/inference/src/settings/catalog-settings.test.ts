import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readModelSettings, type ModelSettings } from './model-settings.ts';
import type { Environment, SettingProblem } from './setting-values.ts';

const gateway = JSON.stringify([{ name: 'gateway', base_url: 'https://gateway.example.com/v1' }]);

function settingsOf(environment: Environment): Promise<ModelSettings> {
  return Effect.runPromise(readModelSettings(environment));
}

async function problemsOf(environment: Environment): Promise<readonly SettingProblem[]> {
  const error = await Effect.runPromise(Effect.flip(readModelSettings(environment)));
  return error.problems;
}

function declaring(declarations: object): Environment {
  return { MODEL_GATEWAYS: gateway, DECLARED_MODELS: JSON.stringify(declarations) };
}

function declaredProblem(detail: string): SettingProblem {
  return { setting: 'DECLARED_MODELS', detail };
}

function allowedProblem(detail: string): SettingProblem {
  return { setting: 'ALLOWED_MODELS', detail };
}

describe('the models declared for a provider in DECLARED_MODELS', () => {
  it('are read for the providers that do not list their own, and for a gateway', async () => {
    const declarations = {
      bedrock: ['eu.anthropic.claude-sonnet-4-5-20250929-v1:0'],
      'bedrock-anthropic': ['eu.anthropic.claude-haiku-4-5-20251001-v1:0'],
      azure: ['gpt-5-production'],
      vertex: ['gemini-2.5-flash'],
      'vertex-anthropic': ['claude-sonnet-4-5@20250929'],
      gateway: ['llama-3.3-70b'],
    };

    const settings = await settingsOf(declaring(declarations));

    expect(settings.declared).toEqual(new Map(Object.entries(declarations)));
  });

  it('are none when the setting is left out', async () => {
    expect((await settingsOf({})).declared).toEqual(new Map());
  });
});

describe('DECLARED_MODELS that stops the start', () => {
  it('names a provider that lists its own models, and a provider that does not exist', async () => {
    const declaringProviders =
      'models are declared for bedrock, bedrock-anthropic, azure, vertex, vertex-anthropic or a gateway of MODEL_GATEWAYS';

    expect(await problemsOf(declaring({ anthropic: ['claude-sonnet-4-5'], mistral: ['large'], 'a/b': [] }))).toEqual([
      declaredProblem(`/anthropic: anthropic lists its own models; ${declaringProviders}`),
      declaredProblem(`/mistral: There is no provider named mistral; ${declaringProviders}`),
      declaredProblem(`/a~1b: There is no provider named a/b; ${declaringProviders}`),
    ]);
  });

  it('names a model id that is empty, too long, has a space or a *, is an ARN, or is declared twice', async () => {
    const ids = [
      '',
      'x'.repeat(257),
      'gpt 5',
      'gpt-*',
      'arn:aws:bedrock:eu-central-1:123456789012:application-inference-profile/a1b2c3',
      'gpt-5',
      'gpt-5',
    ];

    expect(await problemsOf(declaring({ azure: ids }))).toEqual([
      declaredProblem('/azure/0: Expected a model id of 1 to 256 characters without spaces'),
      declaredProblem('/azure/1: Expected a model id of 1 to 256 characters without spaces'),
      declaredProblem('/azure/2: Expected a model id of 1 to 256 characters without spaces'),
      declaredProblem('/azure/3: A declared model is one model id, without a *'),
      declaredProblem(
        '/azure/4: An ARN names an account and a region, which the list of models never shows; give it an alias in MODEL_ALIASES, which is listed by its own name',
      ),
      declaredProblem('/azure/6: gpt-5 is declared twice'),
    ]);
  });

  it('names where it is not a map of lists of text, never quoting a value', async () => {
    expect(await problemsOf({ DECLARED_MODELS: '{"azure": "gpt-5-secret-deployment"}' })).toEqual([
      declaredProblem('/azure: Expected array'),
    ]);
    expect(await problemsOf({ DECLARED_MODELS: 'not json' })).toEqual([declaredProblem('Expected JSON')]);
  });
});

describe('the models a spec may name, in ALLOWED_MODELS', () => {
  it('are read as model references and wildcards of a provider', async () => {
    const settings = await settingsOf({ ALLOWED_MODELS: '["anthropic/*","gateway/llama-3.3-70b","openai/gpt-5*"]' });

    expect(settings.allowed).toEqual(['anthropic/*', 'gateway/llama-3.3-70b', 'openai/gpt-5*']);
  });

  it('allow every model when the setting is left out', async () => {
    expect((await settingsOf({})).allowed).toBeNull();
  });

  it('are refused when the list is empty, since leaving the setting out offers every model', async () => {
    expect(await problemsOf({ ALLOWED_MODELS: '[]' })).toEqual([
      allowedProblem('/: Expected at least one model; leave ALLOWED_MODELS out to offer every model'),
    ]);
  });

  it('are refused when an entry is not provider/model, has a * that is not last, or is an ARN', async () => {
    const entries = [
      'claude',
      '*',
      'anthropic/*/x',
      'bedrock-anthropic/arn:aws:bedrock:eu-central-1:123456789012:application-inference-profile/a1b2c3',
    ];

    expect(await problemsOf({ ALLOWED_MODELS: JSON.stringify(entries) })).toEqual([
      allowedProblem('/0: Expected provider/model, or provider/ followed by a * that stands for any model id'),
      allowedProblem('/1: Expected provider/model, or provider/ followed by a * that stands for any model id'),
      allowedProblem('/2: Expected provider/model, or provider/ followed by a * that stands for any model id'),
      allowedProblem(
        '/3: An ARN names an account and a region; allow the name of an alias in MODEL_ALIASES that is sent to it instead',
      ),
    ]);
  });

  it('are refused when the setting is not a list of text', async () => {
    expect(await problemsOf({ ALLOWED_MODELS: '{"anthropic": true}' })).toEqual([allowedProblem('/: Expected array')]);
  });
});
