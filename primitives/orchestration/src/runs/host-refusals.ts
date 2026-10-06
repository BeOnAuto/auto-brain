import { Unavailable } from '@beonauto/operations';
import { HostElsewhere } from '@beonauto/workflow-host';

export function unavailableUnless(notNow: string): (failure: Readonly<{ detail: string }>) => Unavailable {
  return (failure) => new Unavailable({ detail: failure instanceof HostElsewhere ? failure.detail : notNow });
}
