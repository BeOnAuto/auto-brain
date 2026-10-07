import { formatFive } from './format-five.ts';
import { formatFour } from './format-four.ts';
import { formatOne } from './format-one.ts';
import { formatThree } from './format-three.ts';
import { formatTwo } from './format-two.ts';
import { stateFormat, type StateFormats } from './state-format.ts';

export const stateFormats: StateFormats = {
  current: stateFormat,
  older: [formatOne, formatTwo, formatThree, formatFour, formatFive],
};
