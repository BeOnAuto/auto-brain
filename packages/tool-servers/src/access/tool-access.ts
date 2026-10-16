import { ignored } from '../connections/ignored.ts';
import type { LinkOptions } from '../connections/link-openers.ts';
import type { Describing, ToolServers } from '../openapi/described-api.ts';
import { noConnections, type ConnectionSource } from '../org-servers/connection-source.ts';
import { orgAccessOf } from '../org-servers/org-access.ts';
import type { ServerMessage } from './caller-context.ts';
import { recordingPartsOf, type ContentStore, type RecordingParts } from './entry-reads.ts';
import type { LinkedAccess } from './linked-access.ts';
import { listingWaysOf, type ListingWays } from './listing-ways.ts';
import { runWaysOf, type RunWays } from './run-ways.ts';

export interface ToolAccessOptions {
  readonly client: LinkOptions['client'];
  readonly content: ContentStore;
  readonly reportServerMessage: (report: ServerMessage) => void;
  readonly connections?: ConnectionSource;
  readonly reportLeftOut?: Describing['reportLeftOut'];
  readonly fetch?: LinkOptions['fetch'];
  readonly now?: () => number;
  readonly timing?: LinkOptions['timing'];
  readonly traceMeta?: LinkOptions['traceMeta'];
}

export interface ToolAccess extends RunWays, ListingWays {
  readonly configured: boolean;
  readonly close: () => Promise<void>;
}

export interface LinkedOptions extends ToolAccessOptions, RecordingParts {
  readonly reportLeftOut: Describing['reportLeftOut'];
}

async function linked(settings: ToolServers, options: LinkedOptions): Promise<LinkedAccess> {
  const { linkedAccess } = await import('./linked-access.ts');
  return linkedAccess(settings, options);
}

export function makeToolAccess(settings: ToolServers, options: ToolAccessOptions): ToolAccess {
  const loading: { access?: Promise<LinkedAccess> } = {};
  const recording = recordingPartsOf(settings.servers, options.content);
  const source = options.connections ?? noConnections;
  const access = orgAccessOf(settings, source, () => {
    loading.access ??= linked(settings, { ...options, ...recording, reportLeftOut: options.reportLeftOut ?? ignored });
    return loading.access;
  });
  return {
    configured: settings.servers.length > 0 || source.takesConnections,
    ...runWaysOf(access),
    ...listingWaysOf(access, recording),
    close: async () => {
      await access.close();
      const loaded = await loading.access;
      await loaded?.close();
    },
  };
}
