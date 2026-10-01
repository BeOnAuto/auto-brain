import { Data } from 'effect';

export class InvalidSettingsError extends Data.TaggedError('InvalidSettingsError')<{ readonly message: string }> {}
