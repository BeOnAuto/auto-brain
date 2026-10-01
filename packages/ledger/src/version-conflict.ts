import { Data } from 'effect';

export class VersionConflict extends Data.TaggedError('version_conflict') {}
