// Autocomplete for the playground API. Runtime injections are in facade.js

import { scopeCompletionSource, javascriptLanguage } from '@codemirror/lang-javascript';
import { makeOut } from './facade.js';

// Null-prototype so scopeCompletionSource walks only our own members
// and not Object.prototype noise.
const out = Object.assign(Object.create(null), makeOut());
const scope = Object.assign(Object.create(null), { out });

export const apiCompletions = javascriptLanguage.data.of({
  autocomplete: scopeCompletionSource(scope),
});
