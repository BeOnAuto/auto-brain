import { formatOne } from './format-one.ts';
import { formatTwo } from './format-two.ts';
import { stateFormat, type StateFormats } from './state-format.ts';

export const stateFormats: StateFormats = { current: stateFormat, older: [formatOne, formatTwo] };
