import type { Decider } from '@beonauto/operations';

import type { RunLogEvent } from '../run-log/run-event.ts';
import type { RunInput } from './run-input.ts';
import type { RunState } from './run-state.ts';

export type RunDecider = Decider<RunState, RunInput, RunLogEvent>;
