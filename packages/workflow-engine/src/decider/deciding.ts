import { expressionStripping } from '../dsl/expressions.ts';
import { expressionUnitOf } from '../programs/expression-units.ts';
import { threadStackBytes, unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import type { DecidingOptions, MachineOptions } from '../runner/run-descriptors.ts';

export function deciding<Decided>(options: MachineOptions, decide: (withUnit: DecidingOptions) => Decided): Decided {
  const { sandbox } = options;
  const unit = expressionUnitOf(
    sandbox.take,
    { stackBytes: threadStackBytes, mostAnswerBytes: unitMemoryBytes, clock: sandbox.clock },
    expressionStripping,
  );
  try {
    return decide({ ...options, unit });
  } finally {
    unit.close();
    if (!unit.took()) {
      sandbox.release();
    }
  }
}
