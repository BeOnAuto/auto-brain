export interface SandboxRemovals {
  readonly globals: readonly string[];
  readonly mathMembers: readonly string[];
  readonly dateMethods: readonly string[];
  readonly dateTextMethods: readonly string[];
}

export const sandboxRemovals: SandboxRemovals = {
  globals: ['eval', 'Function', 'WeakRef', 'FinalizationRegistry'],
  mathMembers: ['random'],
  dateMethods: [
    'getDate',
    'getDay',
    'getFullYear',
    'getHours',
    'getMilliseconds',
    'getMinutes',
    'getMonth',
    'getSeconds',
    'getTimezoneOffset',
    'getYear',
    'setDate',
    'setFullYear',
    'setHours',
    'setMilliseconds',
    'setMinutes',
    'setMonth',
    'setSeconds',
    'setYear',
    'toDateString',
    'toLocaleDateString',
    'toLocaleTimeString',
    'toTimeString',
  ],
  dateTextMethods: ['toString', 'toLocaleString'],
};
