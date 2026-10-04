import { describe, expect, it } from 'vitest';

import { inferenceDescriptionFor, inferenceExample } from './inference-description.ts';

const calls =
  'Calls a language model once per execution, with a prompt rendered from the input, and answers with the text of the model or with a JSON value that matches a schema.';

describe('the description of inference on a server', () => {
  it('opens by saying that a spec of inference is a prompt, and which name the tools take', () => {
    expect(inferenceDescriptionFor({ providers: ['anthropic'], aliases: [] })).toMatch(
      /^A spec of the inference primitive is a prompt: instructions a language model follows to turn an input into an answer. In conversation, call it a prompt; the primitive's name, `inference`, is what the tools take. Calls a language model/u,
    );
  });

  it('names the one gateway it calls models through, and how a model is written with it', () => {
    expect(inferenceDescriptionFor({ providers: ['gateway'], aliases: [] })).toContain(
      `${calls} This server calls models through gateway: write model as <provider>/<model id>, with a model id that provider serves, for example gateway/<model id>. A spec document is`,
    );
  });

  it('names every provider it calls models through', () => {
    expect(inferenceDescriptionFor({ providers: ['anthropic', 'gateway'], aliases: [] })).toContain(
      'This server calls models through anthropic, gateway: write model as <provider>/<model id>, with a model id that provider serves, for example anthropic/<model id> or gateway/<model id>. A spec document is',
    );
  });

  it('names the models its operator named, as a spec may give them', () => {
    expect(inferenceDescriptionFor({ providers: ['gateway'], aliases: ['house/fast', 'house/smart'] })).toContain(
      'for example gateway/<model id>. Its operator also named these models, which a spec may give as its model as they are: house/fast, house/smart. A spec document is',
    );
  });

  it('names a wildcard alias as its operator wrote it, and the references it accepts', () => {
    expect(
      inferenceDescriptionFor({ providers: ['gateway'], aliases: ['house/fast', 'anthropic/*', 'openai/gpt-*'] }),
    ).toContain(
      'for example gateway/<model id>. Its operator also named these models, which a spec may give as its model: house/fast, anthropic/*, openai/gpt-*. In a name that ends in *, the * stands for any model id, so a spec may give anthropic/<model id> or openai/gpt-<model id>. A spec document is',
    );
  });

  it('says so when no provider is configured', () => {
    expect(inferenceDescriptionFor({ providers: [], aliases: ['house/fast'] })).toContain(
      `${calls} No model provider is configured on this server yet, so a spec cannot run until its operator configures one. A spec document is`,
    );
  });

  it('keeps the example and the rules of the document whatever the server offers', () => {
    expect(inferenceDescriptionFor({ providers: [], aliases: [] })).toContain(
      `\n\n${inferenceExample}\n\nFront matter:`,
    );
  });
});
