import type { FilterSandbox } from '../filters/filter-verdicts.ts';
import { filterContextOf } from '../programs/kept-contexts.ts';
import { reservedSandbox, type MachineSandbox } from '../programs/reserved-instances.ts';
import { threadStackBytes, unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import { freshInstance } from './fresh-instances.ts';
import { instanceStock } from './instance-stock.ts';

export function hostClock(): number {
  return performance.now();
}

export function machineSandboxOf(clock: () => number = hostClock): MachineSandbox {
  return reservedSandbox(() => freshInstance(unitMemoryBytes), clock);
}

export function filterSandboxOf(clock: () => number = hostClock): FilterSandbox {
  const instances = instanceStock();
  return {
    context: async (opening) =>
      filterContextOf(
        await instances(unitMemoryBytes),
        { stackBytes: threadStackBytes, mostAnswerBytes: unitMemoryBytes, clock },
        opening(),
      ),
    clock,
  };
}
