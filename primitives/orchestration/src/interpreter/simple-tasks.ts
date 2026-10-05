import { millisecondsOf, transform } from '@beonauto/workflow-engine/dsl/evaluation';

import type { Body, Invocation } from './invocation.ts';
import { placeOf } from './place.ts';

export function setTask(invocation: Invocation): Body {
  const { configuration, input, variables } = invocation;
  return { output: transform(configuration, input, variables, placeOf(invocation)) };
}

export async function waitTask(invocation: Invocation): Promise<Body> {
  const { entry, configuration, input, variables, scope } = invocation;
  const milliseconds = millisecondsOf(configuration, input, variables, placeOf(invocation));
  scope.state.beforeWaiting(entry.reference);
  await scope.state.host.sleep(milliseconds, entry.reference);
  return { output: input };
}
