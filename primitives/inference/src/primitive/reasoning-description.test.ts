import { describe, expect, it } from 'vitest';

import { reasoningDescriptionFor, reasoningExample } from './reasoning-description.ts';

const calls =
  'Calls a language model with a prompt rendered from the input, and answers with the text of the model or with a JSON value that matches a schema.';

describe('the reasoning function description on a server', () => {
  it('describes reasoning functions and preserves the name their tools take', () => {
    expect(reasoningDescriptionFor({ providers: ['anthropic'], aliases: [] }, false)).toMatch(
      /^A reasoning function uses a language model and a prompt to turn an input into an answer. Use reasoning function in conversation. The tools identify this function type with `primitive: inference`. Calls a language model/u,
    );
  });

  it('names the one gateway it calls models through, and how a model is written with it', () => {
    expect(reasoningDescriptionFor({ providers: ['gateway'], aliases: [] }, false)).toContain(
      `${calls} This server calls models through gateway: write model as <provider>/<model id>, with a model id that provider serves, for example gateway/<model id>. list_models lists the models this server can call. A reasoning function definition is`,
    );
  });

  it('names every provider it calls models through', () => {
    expect(reasoningDescriptionFor({ providers: ['anthropic', 'gateway'], aliases: [] }, false)).toContain(
      'This server calls models through anthropic, gateway: write model as <provider>/<model id>, with a model id that provider serves, for example anthropic/<model id> or gateway/<model id>. list_models lists the models this server can call. A reasoning function definition is',
    );
  });

  it('names the models its operator named, as a reasoning function may give them', () => {
    expect(
      reasoningDescriptionFor({ providers: ['gateway'], aliases: ['house/fast', 'house/smart'] }, false),
    ).toContain(
      'for example gateway/<model id>. Its operator also named these models, which a reasoning function may give as its model as they are: house/fast, house/smart. list_models lists the models this server can call. A reasoning function definition is',
    );
  });

  it('names a wildcard alias as its operator wrote it, and the references it accepts', () => {
    expect(
      reasoningDescriptionFor(
        { providers: ['gateway'], aliases: ['house/fast', 'anthropic/*', 'openai/gpt-*'] },
        false,
      ),
    ).toContain(
      'for example gateway/<model id>. Its operator also named these models, which a reasoning function may give as its model: house/fast, anthropic/*, openai/gpt-*. In a name that ends in *, the * stands for any model id, so a reasoning function may give anthropic/<model id> or openai/gpt-<model id>. list_models lists the models this server can call. A reasoning function definition is',
    );
  });

  it('says so when no provider is configured', () => {
    expect(reasoningDescriptionFor({ providers: [], aliases: [] }, false)).toContain(
      `${calls} No model provider is configured on this server yet, so a reasoning function cannot run until its operator configures one. A reasoning function definition is`,
    );
  });

  it('keeps the example and the rules of the document whatever the server offers', () => {
    expect(reasoningDescriptionFor({ providers: [], aliases: [] }, false)).toContain(
      `\n\n${reasoningExample}\n\nFront matter:`,
    );
  });
});

describe('the reasoning function description on a server where reasoning functions may name only aliases', () => {
  it('names only the models its operator named when no provider may be named directly', () => {
    expect(reasoningDescriptionFor({ providers: [], aliases: ['house/fast', 'anthropic/*'] }, false)).toContain(
      `${calls} This server calls models only by the names its operator gave them, which a reasoning function may give as its model: house/fast, anthropic/*. In a name that ends in *, the * stands for any model id, so a reasoning function may give anthropic/<model id>. list_models lists the models this server can call. A reasoning function definition is`,
    );
    expect(reasoningDescriptionFor({ providers: [], aliases: ['house/fast'] }, false)).toContain(
      'This server calls models only by the names its operator gave them, which a reasoning function may give as its model as they are: house/fast. list_models',
    );
  });
});

describe('the description of the tools a reasoning function may name', () => {
  it('says how a reasoning function names tools, and what a run does with them, when MCP servers are configured', () => {
    expect(reasoningDescriptionFor({ providers: ['anthropic'], aliases: [] }, true)).toMatch(
      / Any other front matter key is rejected\..* tools: the tools of the MCP servers configured for its brain that it may call, each written server\/tool, or server\/\* for every tool of a server that its operator allows\. A run that names tools gives them to the model, which may call them, at most 25 times in a run, before it answers; each call is recorded on the run as it happens\. A run that called tools and did not succeed is not run again under its id\. A started run whose definition names tools is not run again under its id while it may still be in progress\.$/u,
    );
  });

  it('says that a reasoning function may not name tools when no MCP server is configured', () => {
    expect(reasoningDescriptionFor({ providers: ['anthropic'], aliases: [] }, false)).toMatch(
      / No MCP server is configured on this server, so a reasoning function may not name tools yet\.$/u,
    );
  });
});
