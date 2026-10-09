import { reservedSandbox, type MachineSandbox } from '../programs/reserved-instances.ts';
import { unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import type { SandboxInstance } from '../programs/sandbox-session.ts';
import { freshInstance } from './fresh-instances.ts';
import { instanceStock } from './instance-stock.ts';

export function hostClock(): number {
  return performance.now();
}

export function machineSandboxOf(clock: () => number = hostClock): MachineSandbox {
  return reservedSandbox(() => freshInstance(unitMemoryBytes), clock);
}

export function filterInstances(): () => Promise<SandboxInstance> {
  const instances = instanceStock();
  return () => instances(unitMemoryBytes);
}
