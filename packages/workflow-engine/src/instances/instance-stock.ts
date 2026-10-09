import type { SandboxInstance } from '../programs/sandbox-session.ts';
import { freshInstance } from './fresh-instances.ts';

export type Instances = (memoryBytes: number) => Promise<SandboxInstance>;

export function instanceStock(): Instances {
  const ready = new Map<number, Promise<SandboxInstance>>();
  return (memoryBytes) => {
    const next = ready.get(memoryBytes) ?? freshInstance(memoryBytes);
    ready.set(memoryBytes, freshInstance(memoryBytes));
    return next;
  };
}
