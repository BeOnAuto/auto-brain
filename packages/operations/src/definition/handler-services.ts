import type { BrainScope } from '../caller/brain-scope.ts';
import type { Caller } from '../caller/caller.ts';
import type { OrgScope } from '../caller/org-scope.ts';
import type { Kind, Scope } from '../caller/scope.ts';
import type { BrainReader } from '../ledger/brain-reader.ts';
import type { BrainWriter } from '../ledger/brain-writer.ts';
import type { OrgReader } from '../ledger/org-reader.ts';
import type { OrgWriter } from '../ledger/org-writer.ts';

interface ServicesByScopeAndKind {
  readonly org: {
    readonly query: Caller | OrgScope | OrgReader;
    readonly command: Caller | OrgScope | OrgReader | OrgWriter;
  };
  readonly brain: {
    readonly query: Caller | BrainScope | BrainReader;
    readonly command: Caller | BrainScope | BrainReader | BrainWriter;
  };
}

export type HandlerServices<S extends Scope, K extends Kind> = ServicesByScopeAndKind[S][K];
