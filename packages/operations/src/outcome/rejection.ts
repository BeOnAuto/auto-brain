import type { Conflict } from './conflict.ts';
import type { NotFound } from './not-found.ts';
import type { Unavailable } from './unavailable.ts';

type AnyRejection = NotFound | Conflict | Unavailable;

export type DeclarableReason = AnyRejection['_tag'];

export type Rejection<R extends DeclarableReason = DeclarableReason> = Extract<AnyRejection, { readonly _tag: R }>;
