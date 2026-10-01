import type { Conflict } from './conflict.ts';
import type { NotFound } from './not-found.ts';
import type { Unavailable } from './unavailable.ts';

type AnyRefusal = NotFound | Conflict | Unavailable;

export type DeclarableReason = AnyRefusal['_tag'];

export type Refusal<R extends DeclarableReason = DeclarableReason> = Extract<AnyRefusal, { readonly _tag: R }>;
