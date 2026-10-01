import type { BrainContext } from '../caller/brain-context.ts';
import type { Caller } from '../caller/caller.ts';
import type { OperationKind, OperationScope } from '../caller/operation-scope.ts';
import type { OrgContext } from '../caller/org-context.ts';
import type { BrainReader } from '../ledger/brain-reader.ts';
import type { BrainWriter } from '../ledger/brain-writer.ts';
import type { OrgReader } from '../ledger/org-reader.ts';
import type { OrgWriter } from '../ledger/org-writer.ts';

interface ServicesByScopeAndKind {
  readonly org: {
    readonly query: Caller | OrgContext | OrgReader;
    readonly command: Caller | OrgContext | OrgReader | OrgWriter;
  };
  readonly brain: {
    readonly query: Caller | BrainContext | BrainReader;
    readonly command: Caller | BrainContext | BrainReader | BrainWriter;
  };
}

export type HandlerServices<S extends OperationScope, K extends OperationKind> = ServicesByScopeAndKind[S][K];
