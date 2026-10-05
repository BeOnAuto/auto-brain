import type { Place } from '@beonauto/workflow-engine/dsl/evaluation';

import type { Invocation } from './invocation.ts';
import { placeIn } from './run-state.ts';

export function placeOf({ entry, scope }: Invocation): Place {
  return placeIn(scope.state, entry.reference);
}
