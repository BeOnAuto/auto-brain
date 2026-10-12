import { Layer } from 'effect';

import { defaultServerOptions, type Composed, type ServerOptions } from '../../lifecycle/lifecycle.ts';

export function optionsComposing(services: Layer.Layer<never>, serve: Composed<never>['serve']): ServerOptions<never> {
  return { ...defaultServerOptions, composed: () => ({ services, serve }) };
}

export function optionsServing(serve: Composed<never>['serve']): ServerOptions<never> {
  return optionsComposing(Layer.empty, serve);
}
