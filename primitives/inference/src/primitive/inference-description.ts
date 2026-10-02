import { offeredOptions, providerNamespaces } from '../model/offered-provider-options.ts';

const offers = providerNamespaces
  .map((namespace) => `${namespace}: ${offeredOptions(namespace).join(', ')}`)
  .join('; ');

const introduction = [
  'Calls a language model once per execution, with a prompt rendered from the input,',
  'and answers with the text of the model or with a JSON value that matches a schema.',
  'A spec document is YAML front matter between --- lines, then a Liquid template, for example:',
].join(' ');

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

export const inferenceDescription = `${introduction}\n\n${inferenceExample}\n\n${rules}`;
