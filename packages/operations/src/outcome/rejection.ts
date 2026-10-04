import type { Conflict, ConflictKind } from './conflict.ts';
import type { InvalidInput } from './invalid-input.ts';
import type { NotFound } from './not-found.ts';
import type { Unavailable, UnavailableKind } from './unavailable.ts';

type AnyRejection = NotFound | Conflict | Unavailable | InvalidInput;

export type DeclarableReason = AnyRejection['_tag'];

export type RejectionKind = ConflictKind | UnavailableKind;

export type Rejection<R extends DeclarableReason = DeclarableReason> = Extract<AnyRejection, { readonly _tag: R }>;
