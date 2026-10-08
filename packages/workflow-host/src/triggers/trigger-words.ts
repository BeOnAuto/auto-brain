import type { StartingTrigger } from '@beonauto/specs';

const triggerNames: Readonly<Record<StartingTrigger['kind'], string>> = {
  event: 'event trigger',
  cron: 'cron schedule',
  every: 'every schedule',
};

export function triggerNamed(kind: StartingTrigger['kind']): string {
  return triggerNames[kind];
}
