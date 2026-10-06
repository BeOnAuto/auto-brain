import { describe, expect, it } from 'vitest';

import { inferenceDescriptionFor, inferenceExample } from './inference-description.ts';

const calls =
  'Calls a language model once per execution, with a prompt rendered from the input, and answers with the text of the model or with a JSON value that matches a schema.';

describe('the description of inference on a server', () => {
  it('opens by saying that a spec of inference is a reason function, and which name the tools take', () => {
    expect(inferenceDescriptionFor({ providers: ['anthropic'], aliases: [] }, false)).toMatch(
      /^A spec of the inference primitive is a reason function: it reasons with a language model, following a prompt, to turn an input into an answer. In conversation, call it a reason function; the primitive's name, `inference`, is what the tools take. Calls a language model/u,
    );
  });

  it('names the one gateway it calls models through, and how a model is written with it', () => {
    expect(inferenceDescriptionFor({ providers: ['gateway'], aliases: [] }, false)).toContain(
      `${calls} This server calls models through gateway: write model as <provider>/<model id>, with a model id that provider serves, for example gateway/<model id>. list_models lists the models this server can call. A spec document is`,
    );
  });

  it('names every provider it calls models through', () => {
    expect(inferenceDescriptionFor({ providers: ['anthropic', 'gateway'], aliases: [] }, false)).toContain(
      'This server calls models through anthropic, gateway: write model as <provider>/<model id>, with a model id that provider serves, for example anthropic/<model id> or gateway/<model id>. list_models lists the models this server can call. A spec document is',
    );
  });

  it('names the models its operator named, as a spec may give them', () => {
    expect(
      inferenceDescriptionFor({ providers: ['gateway'], aliases: ['house/fast', 'house/smart'] }, false),
    ).toContain(
      'for example gateway/<model id>. Its operator also named these models, which a spec may give as its model as they are: house/fast, house/smart. list_models lists the models this server can call. A spec document is',
    );
  });

  it('names a wildcard alias as its operator wrote it, and the references it accepts', () => {
    expect(
      inferenceDescriptionFor(
        { providers: ['gateway'], aliases: ['house/fast', 'anthropic/*', 'openai/gpt-*'] },
        false,
      ),
    ).toContain(
      'for example gateway/<model id>. Its operator also named these models, which a spec may give as its model: house/fast, anthropic/*, openai/gpt-*. In a name that ends in *, the * stands for any model id, so a spec may give anthropic/<model id> or openai/gpt-<model id>. list_models lists the models this server can call. A spec document is',
    );
  });

  it('says so when no provider is configured', () => {
    expect(inferenceDescriptionFor({ providers: [], aliases: [] }, false)).toContain(
      `${calls} No model provider is configured on this server yet, so a spec cannot run until its operator configures one. A spec document is`,
    );
  });

  it('keeps the example and the rules of the document whatever the server offers', () => {
    expect(inferenceDescriptionFor({ providers: [], aliases: [] }, false)).toContain(
      `\n\n${inferenceExample}\n\nFront matter:`,
    );
  });
});

describe('the description of inference on a server where specs may name only aliases', () => {
  it('names only the models its operator named when no provider may be named directly', () => {
    expect(inferenceDescriptionFor({ providers: [], aliases: ['house/fast', 'anthropic/*'] }, false)).toContain(
      `${calls} This server calls models only by the names its operator gave them, which a spec may give as its model: house/fast, anthropic/*. In a name that ends in *, the * stands for any model id, so a spec may give anthropic/<model id>. list_models lists the models this server can call. A spec document is`,
    );
    expect(inferenceDescriptionFor({ providers: [], aliases: ['house/fast'] }, false)).toContain(
      'This server calls models only by the names its operator gave them, which a spec may give as its model as they are: house/fast. list_models',
    );
  });
});

describe('the description of the tools a spec may name', () => {
  it('says how a spec names tools, and what a run does with them, when MCP servers are configured', () => {
    expect(inferenceDescriptionFor({ providers: ['anthropic'], aliases: [] }, true)).toMatch(
      / Any other front matter key is rejected\..* tools: the tools of the MCP servers configured for its brain that it may call, each written server\/tool, or server\/\* for every tool of a server that its operator allows\. A run that names tools gives them to the model, which may call them, at most 25 times in a run, before it answers; each call is recorded on the run as it happens, and a run that names tools and did not succeed is not run again under its id, nor while it may still be in progress\.$/u,
    );
  });

  it('says that a spec may not name tools when no MCP server is configured', () => {
    expect(inferenceDescriptionFor({ providers: ['anthropic'], aliases: [] }, false)).toMatch(
      / No MCP server is configured on this server, so a spec may not name tools yet\.$/u,
    );
  });
});
