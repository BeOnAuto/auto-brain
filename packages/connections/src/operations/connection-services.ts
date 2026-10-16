import type { Effect, Redacted } from 'effect';

import type { ConnectPages } from '../links/connect-page.ts';
import type { ConnectionPolicy } from '../policy/connection-policy.ts';

export interface SecretKeeping {
  readonly keep: (value: Redacted.Redacted) => Effect.Effect<string, { readonly detail: string }>;
  readonly forget: (id: string) => Effect.Effect<void>;
}

export interface ConnectionServices {
  readonly secrets: SecretKeeping;
  readonly policy: ConnectionPolicy;
  readonly fileEntries: readonly string[];
  readonly providers: readonly string[];
  readonly pages: ConnectPages;
  readonly signIn: boolean;
}
