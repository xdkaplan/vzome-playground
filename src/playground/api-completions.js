// Autocomplete for `out`, the playground's custom emit-geometry contract.
// Derived from facade.js's makeOut() so there's a single source of truth — add
// a method there and it completes here automatically. Registered as extra JS
// language data so it merges with CodeMirror's built-in completions. The real
// vZome surface gets type-derived completions later.

import { scopeCompletionSource, javascriptLanguage } from '@codemirror/lang-javascript';
import { makeOut } from './facade.js';

// Null-prototype so scopeCompletionSource walks only our own members
// (struts, balls, strut, ball) and not Object.prototype noise.
const out = Object.assign(Object.create(null), makeOut());
const scope = Object.assign(Object.create(null), { out });

export const apiCompletions = javascriptLanguage.data.of({
  autocomplete: scopeCompletionSource(scope),
});
