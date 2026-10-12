import type { Principal } from '@on.auto/identity';

export interface ApiBindings {
  readonly abortConnection: () => void;
}

export interface ApiEnv {
  readonly Bindings: ApiBindings;
  readonly Variables: {
    readonly requestId: string;
    readonly principal: Principal;
  };
}
