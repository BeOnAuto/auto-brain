import { writeFileSync } from 'node:fs';

import { configFileSchemaPath, configFileSchemaText } from './src/settings/config-file-schema.ts';

writeFileSync(configFileSchemaPath, configFileSchemaText());
process.stdout.write(`Wrote ${configFileSchemaPath}\n`);
