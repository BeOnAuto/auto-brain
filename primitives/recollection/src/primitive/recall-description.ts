import { mostSyntaxDepth } from '@beonauto/workflow-engine/dsl';

import { recallBounds } from '../run/recall-bounds.ts';

const recallExample = [
  '---',
  'description: The reviews of each campaign, latest last, as the review-brief function wrote them',
  'language: jq',
  'source:',
  '  events:',
  '    - type: execution_succeeded',
  '      subject: inference/review-brief',
  'view:',
  '  initial: {}',
  '  schema: {type: object, maxProperties: 50, additionalProperties: {type: array, maxItems: 20}}',
  'input:',
  '  schema: {type: object, required: [campaign], properties: {campaign: {type: string}, last: {type: integer, minimum: 1, maximum: 50}}}',
  "answer: '.[$input.campaign] // [] | .[-($input.last // 5):]'",
  '---',
  '($event.data.output | if type == "object" then .campaign else null end | if type == "string" then . else "unknown" end) as $campaign',
  '| .[$campaign] += [{ at: $event.time, verdict: ($event.data.output.verdict? // "none" | tostring | .[0:200]), run: $event.source }]',
  '| .[$campaign] |= .[-20:]',
  '| to_entries | sort_by(.value[-1].at) | .[-50:] | from_entries',
].join('\n');

const naming = [
  'A recall function keeps a view folded from the brain’s own history, which already holds the runs of each function and workflow,',
  'with the output of each run that succeeds, the definitions saved and the events published to the brain.',
  'A program in jq, its fold, folds each of those events its filters match into the view, so no workflow needs to write into a log,',
  'and a run that matches is folded whoever started it.',
  'A run of the recall function answers from the view as it stands, without a model,',
  'such as what one function posted today, the last reviews of a campaign or the latest verdict per region.',
  'Use recall function in conversation. The tools identify this function type with `primitive: recollection`.',
].join(' ');

const format = 'A recall function definition is YAML front matter between --- lines, then the fold in jq, for example:';

const rules = [
  `Front matter: language (required, jq); source: events (required, 1 to ${recallBounds.mostFilters} filters, each with a type and optionally source, subject and data);`,
  'view: initial (the view before any event, null when left out) and schema (a JSON Schema the view must keep after every fold);',
  'description; input: schema; output: schema; answer (a jq expression on the view as . with the run input as $input; without it a run answers the view).',
  'The events are the brain’s own facts, such as execution_succeeded of a function whose subject is <primitive>/<name>, with data holding primitive, name, version, caller and,',
  'on a success, output, or output_bytes when the output is too large, and the events published to the brain as their publishers gave them.',
  'The fold reads the view as . and the event as $event and answers the next view; it sees nothing else:',
  'now, env, $ENV, input, inputs, input_filename, input_line_number, $__loc__, builtins, $ARGS, localtime, strflocaltime,',
  'debug, stderr, halt, halt_error, label and break are rejected, and so is a variable it does not bind. Read the time of an event as $event.time.',
  'Guard a fold against every value an event may hold: a fold that raises an error, gives no output or more than one,',
  `does more than ${recallBounds.mostWork} units of work, nests deeper than ${recallBounds.mostValueDepth} levels, or answers a view over ${recallBounds.mostViewBytes} bytes`,
  'or one its schema refuses stops the view at that event, and runs then answer conflict, kind stalled, until a corrected version is saved.',
  `A program nests at most ${mostSyntaxDepth} levels. Saving a new version builds the view again from the start of the brain’s history:`,
  'meanwhile runs answer unavailable, kind rebuilding, and trying again later succeeds. A run never waits for the view to catch up,',
  'so it may not show an event recorded a moment ago; get_spec shows the view’s standing: live, rebuilding, waiting or stalled, and how far it lags.',
  'An answer that raises an error, gives no output or more than one, or answers what the output schema refuses is rejected with conflict, kind unworkable.',
].join(' ');

export const recallDescription = `${naming} ${format}\n\n${recallExample}\n\n${rules}`;
