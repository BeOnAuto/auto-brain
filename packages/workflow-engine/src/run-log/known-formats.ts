import { formatFive } from './formats/format-five.ts';
import { formatFour } from './formats/format-four.ts';
import { formatOne } from './formats/format-one.ts';
import { formatSix } from './formats/format-six.ts';
import { formatThree } from './formats/format-three.ts';
import { formatTwo } from './formats/format-two.ts';
import { stateFormat, type StateFormats } from './state-format.ts';

export const stateFormats: StateFormats = {
  current: stateFormat,
  older: [formatOne, formatTwo, formatThree, formatFour, formatFive, formatSix],
};
