import type { BrainReader } from './brain-reader.ts';
import type { BrainScope } from './brain-scope.ts';
import type { BrainWriter } from './brain-writer.ts';
import type { Caller } from './caller.ts';
import type { OrgReader } from './org-reader.ts';
import type { OrgScope } from './org-scope.ts';
import type { OrgWriter } from './org-writer.ts';
import type { Kind, Scope } from './scope.ts';

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
