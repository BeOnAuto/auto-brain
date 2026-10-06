import { mostSyntaxDepth } from '@beonauto/workflow-engine/dsl';

import { computationBounds } from '../run/run-bounds.ts';

const computationExample = [
  '---',
  'description: Spend, pace and projection per campaign, in cents',
  'language: jq',
  'input:',
  '  schema:',
  '    type: object',
  '    required: [rows, period]',
  '    properties:',
  '      rows: {type: array, items: {type: object, required: [campaign, cost_cents, budget_cents]}}',
  '      period: {type: object, required: [days_elapsed, days_total]}',
  'output:',
  '  schema: {type: object, required: [campaigns, total_spend_cents]}',
  '---',
  '.period as $p',
  '| .rows',
  '| group_by(.campaign)',
  '| map({ campaign: .[0].campaign,',
  '        spend_cents: (map(.cost_cents) | add),',
  '        budget_cents: .[0].budget_cents })',
  '| map(. + { projected_cents: (.spend_cents * $p.days_total / $p.days_elapsed | floor) })',
  '| { campaigns: ., total_spend_cents: (map(.spend_cents) | add) }',
].join('\n');

const naming = [
  'A computation function runs a program on its input and answers with exactly one output,',
  'the same output for the same input every time: a calculation or a transformation, such as totals, paces and projections from rows of figures.',
  'Use computation function in conversation. The tools identify this function type with `primitive: computation`.',
].join(' ');

const format =
  'A computation function definition is YAML front matter between --- lines, then a program in jq, for example:';

const rules = [
  'Front matter: language (required, jq); description; input: schema (a JSON Schema of the input, which may be any JSON value);',
  'output: schema (a JSON Schema of the output). Any other key is rejected.',
  'The program reads its input as . and sees nothing else:',
  'now, env, $ENV, input, inputs, input_filename, input_line_number, $__loc__, builtins, localtime, strflocaltime,',
  'debug, stderr, halt, halt_error, label and break are rejected, and so is a variable the program does not bind.',
  'Numbers are double-precision: integers are exact up to 2^53 and there is no decimal type, so compute money in whole minor units such as cents.',
  'The dialect differs from jq: unique and unique_by keep the order values first appear in, to_entries and tojson sort keys,',
  'strings compare by UTF-16 code unit, regular expressions have no lookahead or backreferences,',
  'a pipe inside a reduce or foreach update needs parentheses, and function parameters are filters, never $variables.',
  `A program nests at most ${mostSyntaxDepth} levels: each expression inside another counts one,`,
  'and so does each link of a chain of pipes, of operators such as + or //, of definitions or of bindings.',
  `A run may do ${computationBounds.mostWork} units of work, build values nested at most ${computationBounds.mostValueDepth} levels,`,
  `nest its evaluation at most ${computationBounds.mostEvaluationDepth} levels, which a function that calls itself once reaches after about 2,000 calls,`,
  `and take at most ${computationBounds.deadlineMs} ms and ${computationBounds.heapMegabytes} MiB of memory.`,
  'A run whose program raises an error, gives no output or more than one, does more work or builds deeper values than a run may,',
  'or answers what the output schema refuses is rejected with conflict, kind unworkable, with the line it came from:',
  'running it again gives the same result, so update the definition. Problems in a definition are reported with their line.',
].join(' ');

export const computationDescription = `${naming} ${format}\n\n${computationExample}\n\n${rules}`;
