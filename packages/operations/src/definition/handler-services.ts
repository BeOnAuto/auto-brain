import type { PlaybookContext } from '../caller/brain-context.ts';
import type { CallLineage } from '../caller/call-lineage.ts';
import type { Caller } from '../caller/caller.ts';
import type { OperationKind, OperationScope } from '../caller/operation-scope.ts';
import type { OrgContext } from '../caller/org-context.ts';
import type { PlaybookReader } from '../ledger/brain-reader.ts';
import type { PlaybookWriter } from '../ledger/brain-writer.ts';
import type { OrgReader } from '../ledger/org-reader.ts';
import type { OrgWriter } from '../ledger/org-writer.ts';

interface ServicesByScopeAndKind {
  readonly org: {
    readonly query: Caller | OrgContext | OrgReader;
    readonly command: Caller | OrgContext | OrgReader | OrgWriter;
  };
  readonly playbook: {
    readonly query: Caller | PlaybookContext | PlaybookReader;
    readonly command: Caller | PlaybookContext | PlaybookReader | PlaybookWriter | CallLineage;
  };
}

export type HandlerServices<S extends OperationScope, K extends OperationKind> = ServicesByScopeAndKind[S][K];
