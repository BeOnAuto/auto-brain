import { foundPlaybook } from '@on.auto/playbooks';
import {
  defineDryRun,
  defineExecute,
  defineIntrospect,
  defineSearch,
  defineSearchInOrg,
  defineValidate,
  type ToolAccess,
} from '@on.auto/tool-servers';

export function toolOperationsOf(tools: ToolAccess) {
  return {
    inOrg: [defineSearchInOrg(tools, foundPlaybook)],
    inPlaybook: [
      defineSearch(tools),
      defineIntrospect(tools),
      defineValidate(tools),
      defineDryRun(tools),
      defineExecute(tools),
    ],
  };
}

export type ServedToolOperations = ReturnType<typeof toolOperationsOf>;
