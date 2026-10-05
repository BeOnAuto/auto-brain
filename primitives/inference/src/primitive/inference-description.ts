import { aliasPatternOf, isWildcardAlias } from '../model/model-alias.ts';
import type { OfferedModels } from '../model/offered-models.ts';
import { offeredOptions, providerNamespaces } from '../model/offered-provider-options.ts';

const offers = providerNamespaces
  .map((namespace) => `${namespace}: ${offeredOptions(namespace).join(', ')}`)
  .join('; ');

const naming = [
  'A spec of the inference primitive is a reason function: it reasons with a language model, following a prompt, to turn',
  'an input into an answer.',
  "In conversation, call it a reason function; the primitive's name, `inference`, is what the tools take.",
].join(' ');

const calls = [
  'Calls a language model once per execution, with a prompt rendered from the input,',
  'and answers with the text of the model or with a JSON value that matches a schema.',
].join(' ');

const format = 'A spec document is YAML front matter between --- lines, then a Liquid template, for example:';

const noProvider =
  'No model provider is configured on this server yet, so a spec cannot run until its operator configures one.';

function anyModelUnder(wildcards: readonly string[]): string {
  const examples = wildcards.map((wildcard) => `${aliasPatternOf(wildcard).prefix}<model id>`).join(' or ');
  return ` In a name that ends in *, the * stands for any model id, so a spec may give ${examples}.`;
}

const listedByListModels = 'list_models lists the models this server can call.';

function aliasesNamed(lead: string, aliases: readonly string[]): string {
  const wildcards = aliases.filter((alias) => isWildcardAlias(alias));
  return wildcards.length === 0
    ? `${lead}, which a spec may give as its model as they are: ${aliases.join(', ')}.`
    : `${lead}, which a spec may give as its model: ${aliases.join(', ')}.${anyModelUnder(wildcards)}`;
}

function namedModels(aliases: readonly string[]): string {
  return aliases.length === 0 ? '' : ` ${aliasesNamed('Its operator also named these models', aliases)}`;
}

function offerOf({ providers, aliases }: OfferedModels): string {
  if (providers.length === 0) {
    return aliases.length === 0
      ? noProvider
      : `${aliasesNamed('This server calls models only by the names its operator gave them', aliases)} ${listedByListModels}`;
  }
  const examples = providers.map((provider) => `${provider}/<model id>`).join(' or ');
  return `This server calls models through ${providers.join(', ')}: write model as <provider>/<model id>, with a model id that provider serves, for example ${examples}.${namedModels(aliases)} ${listedByListModels}`;
}

export const inferenceExample = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'description: Summarizes an account',
  'config: {max_output_tokens: 800, temperature: 0.2}',
  'input:',
  '  schema: {type: object, properties: {account: {type: string}}, required: [account]}',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {summary: {type: string}}, required: [summary], additionalProperties: false}',
  '---',
  '{% system %}You write for a sales team.{% endsystem %}',
  'Summarize {{ input.account }} as of {{ today }}.',
].join('\n');

const rules = [
  'Front matter: model (required, provider/model); description;',
  'config: max_output_tokens (default 1024, at most 64000), temperature, top_p, seed, stop_sequences,',
  'reasoning (none, minimal, low, medium, high or xhigh);',
  'input: schema (a JSON Schema whose root is an object) and default (values merged under the input);',
  'output: format (text, the default, or json) and schema (required for json, not allowed for text);',
  `provider_options holds, under a provider namespace, only options that shape how the model reasons or writes its answer (${offers}),`,
  "and under a gateway's name only the request body fields its operator allows; any other option is rejected.",
  'Any other front matter key is rejected.',
  'The template reads only input, today (YYYY-MM-DD, UTC) and now (ISO 8601, UTC).',
  'One {% system %}...{% endsystem %} block at its top level may hold the instructions; the rest is the message.',
  'It has the data and string filters of Liquid, and money, clip and words; it cannot include other templates.',
  'The input of an execution is a JSON object. Problems in a document are reported with their line.',
].join(' ');

export function inferenceDescriptionFor(offered: OfferedModels): string {
  return `${naming} ${calls} ${offerOf(offered)} ${format}\n\n${inferenceExample}\n\n${rules}`;
}
