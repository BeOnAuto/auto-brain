import type { ServerInfo } from '@beonauto/api';

import manifest from '../../../package.json' with { type: 'json' };

export const release: ServerInfo = { name: manifest.name, version: manifest.version };
