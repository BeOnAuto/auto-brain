import type { Environment } from '@beonauto/config';
import { providerStatus, readModelSettings } from '@beonauto/inference';
import { Effect } from 'effect';

const noModelYet = 'none configured; copy .env.example to .env and put a key in it';

function modelsIn(settings: Environment): string {
  const { configured } = providerStatus(Effect.runSync(readModelSettings(settings)), { entraId: false });
  return configured.length === 0 ? noModelYet : configured.join(', ');
}

export function readyNotice(port: number, workflows: string, settings: Environment): string {
  return [
    'auto-brain is ready',
    `  server     http://localhost:${port}`,
    `  workflows  ${workflows}`,
    `  models     ${modelsIn(settings)}`,
    `  MCP        http://localhost:${port}/mcp`,
  ].join('\n');
}
