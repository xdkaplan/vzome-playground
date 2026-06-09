// Autocomplete for the one custom, permanent piece of the playground "magic
// API": `out`, our output collector (the emit-geometry contract, from
// facade.js). It's the only injected name that is genuinely ours AND stable
// regardless of how vZome's real API evolves.
//
// Everything else the runner injects is either standard JS (console) or the
// real vZome surface (field, symmetry, origin, input); those completions
// should come from the actual types once this lives in the vzome repo, not
// hand-listed here.
//
// CodeMirror's JS mode only completes keywords and locally-declared
// identifiers, so `out` is invisible without this. It's registered as extra JS
// language data so it MERGES with the built-in local-scope completions rather
// than replacing them.

import { snippetCompletion as snip } from '@codemirror/autocomplete';
import { javascriptLanguage } from '@codemirror/lang-javascript';

// Top-level names available with no imports inside a script.
const TOP_LEVEL = [
  { label: 'out', type: 'variable', info: 'Output collector. Add geometry with out.strut(a, b) and out.ball(p); the playground builds a mesh from it after the script runs.' },
];

// Members offered after `<name>.`. Functions are snippets so the parens (and a
// placeholder per argument) come for free.
const MEMBERS = {
  out: [
    snip('strut(${a}, ${b})', { label: 'strut', type: 'method', detail: '(a, b)', info: 'Add a strut (edge) between two points.' }),
    snip('ball(${p})', { label: 'ball', type: 'method', detail: '(p)', info: 'Add a ball (vertex) at a point.' }),
    { label: 'struts', type: 'property', info: 'Array of [a, b] strut pairs collected so far.' },
    { label: 'balls', type: 'property', info: 'Array of points collected so far.' },
  ],
};

function apiCompletionSource(context) {
  // Member access: `out.`, `out.st`, etc. Only claim names we document;
  // returning null for anything else lets other sources (and the real vZome
  // objects, later) fall through untouched.
  const member = context.matchBefore(/([A-Za-z_$][\w$]*)\.\w*$/);
  if (member) {
    const obj = member.text.slice(0, member.text.indexOf('.'));
    const options = MEMBERS[obj];
    if (!options) return null;
    return { from: member.from + obj.length + 1, options };
  }

  // Top-level identifier. Don't pop up on an empty position unless explicitly
  // requested (Ctrl-Space); otherwise complete the custom magic-API names.
  const word = context.matchBefore(/[\w$]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return { from: word.from, options: TOP_LEVEL };
}

export const apiCompletions = javascriptLanguage.data.of({
  autocomplete: apiCompletionSource,
});
