import type { AppRuntime } from '@beonauto/api';
import type { DispatcherServices } from '@beonauto/operations';
import type { HostReports } from '@beonauto/workflow-host';

import { logHostNote } from '../logging/host-notes.ts';
import { logLostWorkflowConnection, logUnsettled, logWorkflowTrouble } from '../logging/logging.ts';
import { inRuntime } from './in-runtime.ts';

const unsettledBecause = {
  unknown_run: 'The ledger has no such run',
  settled_otherwise: 'The run was settled otherwise before',
} as const;

export function hostReports(runtime: AppRuntime<DispatcherServices>): HostReports {
  return {
    unsettled: ({ org, brain, runId, receipt }) =>
      inRuntime(runtime, logUnsettled({ org, brain, runId, reason: unsettledBecause[receipt] })),
    trouble: (what, cause) => inRuntime(runtime, logWorkflowTrouble(what, cause)),
    lostConnection: (error) => {
      void runtime.run(logLostWorkflowConnection(error));
    },
    note: (note) => inRuntime(runtime, logHostNote(note)),
  };
}
