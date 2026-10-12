import { PlaybookIdSchema } from '@on.auto/operations';
import { Schema } from 'effect';

export const PlaybookSchema = Schema.Struct({
  id: PlaybookIdSchema.annotate({ description: 'The id of the playbook, unique within its org' }),
  name: Schema.String.annotate({ description: 'The display name of the playbook' }),
  description: Schema.String.annotate({ description: 'What the playbook is for, or empty' }),
  status: Schema.Literals(['active', 'retired']).annotate({ description: 'active, or retired for good' }),
  created_at: Schema.String.annotate({ description: 'When the playbook was created, in ISO 8601 UTC' }),
  created_by: Schema.String.annotate({ description: 'The id of the caller who created the playbook' }),
  updated_at: Schema.String.annotate({ description: 'When the playbook last changed, in ISO 8601 UTC' }),
  retired_at: Schema.optionalKey(
    Schema.String.annotate({ description: 'When the playbook was retired, in ISO 8601 UTC' }),
  ),
}).annotate({ identifier: 'Playbook', description: 'A playbook of the org' });

export type Playbook = typeof PlaybookSchema.Type;
