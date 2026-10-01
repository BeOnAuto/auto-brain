import type { Principal } from '@beonauto/identity';

export interface ApiEnv {
  readonly Variables: {
    readonly requestId: string;
    readonly principal: Principal;
  };
}
