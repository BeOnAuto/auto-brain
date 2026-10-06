import type { Dialect, Refusal } from '@beonauto/workflow-engine/dsl';

const elsewhere =
  'reads something other than the view and its event or input, so the same history would not give the same answer';

const hostTimeZone = "reads the server's time zone, so it is not the same everywhere; use the UTC date functions";

const sideways =
  'writes outside the program; a fold answers only with the next view, and an answer only with its output';

const brokenLabels = 'gives wrong answers in this dialect of jq; use reduce, foreach, limit or first instead';

const refused: readonly Refusal[] = [
  {
    name: 'now',
    why: 'reads the clock, so the same events would not fold to the same view; read the time of an event as $event.time',
  },
  { name: 'env', why: elsewhere },
  { name: '$ENV', why: elsewhere },
  { name: 'input', why: elsewhere },
  { name: 'inputs', why: elsewhere },
  { name: 'input_filename', why: elsewhere },
  { name: 'input_line_number', why: elsewhere },
  { name: '$__loc__', why: elsewhere },
  { name: 'builtins', why: elsewhere },
  {
    name: '$ARGS',
    why: 'reads arguments a recall function is never given; the fold reads $event and the answer $input',
  },
  { name: 'localtime', why: hostTimeZone },
  { name: 'strflocaltime', why: hostTimeZone },
  { name: 'debug', why: sideways },
  { name: 'stderr', why: sideways },
  { name: 'halt', why: sideways },
  { name: 'halt_error', why: sideways },
  { name: 'label', why: brokenLabels },
  { name: 'break', why: brokenLabels },
];

export const foldVariable = 'event';

export const answerVariable = 'input';

export const foldDialect: Dialect = { refused, variables: [foldVariable] };

export const answerDialect: Dialect = { refused, variables: [answerVariable] };

export const filterDialect: Dialect = { refused, variables: [] };
