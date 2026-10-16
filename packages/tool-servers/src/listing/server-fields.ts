import { cutToFailureBound } from '../bounds/call-bounds.ts';
import type { Served, Unusable } from '../org-servers/org-servers.ts';
import { everyPlaybook } from '../settings/server-settings.ts';
import type { ServerFields, UnavailableServer } from './tool-server.ts';

export function serverFieldsOf({ name, type, record_content, playbooks, connection }: Served): ServerFields {
  return {
    name,
    type,
    record_content,
    playbooks: playbooks ?? [everyPlaybook],
    ...(connection === null ? {} : { connection }),
  };
}

export function unavailableServer(settings: Served, { because, detail }: Unusable): UnavailableServer {
  return { ...serverFieldsOf(settings), unavailable: cutToFailureBound(detail), because };
}
