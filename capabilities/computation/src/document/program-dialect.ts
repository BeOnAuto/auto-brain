import type { Dialect } from '@beonauto/workflow-engine/dsl';

const elsewhere = 'reads something other than the input, so the same input would not give the same output; pass it in';

const hostTimeZone = "reads the server's time zone, so it is not the same everywhere; use the UTC date functions";

const sideways = 'writes outside the program; a computation function answers only with its output';

const brokenLabels = 'gives wrong answers in this dialect of jq; use reduce, foreach, limit or first instead';

export const computationDialect: Dialect = {
  refused: [
    {
      name: 'now',
      why: `reads the clock, so the same input would not give the same output; pass the time in the input`,
    },
    { name: 'env', why: elsewhere },
    { name: '$ENV', why: elsewhere },
    { name: 'input', why: elsewhere },
    { name: 'inputs', why: elsewhere },
    { name: 'input_filename', why: elsewhere },
    { name: 'input_line_number', why: elsewhere },
    { name: '$__loc__', why: elsewhere },
    { name: 'builtins', why: elsewhere },
    { name: 'localtime', why: hostTimeZone },
    { name: 'strflocaltime', why: hostTimeZone },
    { name: 'debug', why: sideways },
    { name: 'stderr', why: sideways },
    { name: 'halt', why: sideways },
    { name: 'halt_error', why: sideways },
    { name: 'label', why: brokenLabels },
    { name: 'break', why: brokenLabels },
  ],
  variables: [],
};
