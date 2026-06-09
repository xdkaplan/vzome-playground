// Autocomplete for the playground "magic API" — the globals that runner.js
// injects into every user script (see facade.js / runner.js). CodeMirror's
// JavaScript mode only completes keywords and locally-declared identifiers; it
// has no idea these injected names exist. This adds a completion source for
// them, registered as extra JS language data so it MERGES with the built-in
// local-scope completions rather than replacing them.
//
// Keep in sync with buildFacade(): whatever the facade exposes, document here.

import { snippetCompletion as snip } from '@codemirror/autocomplete';
import { javascriptLanguage } from '@codemirror/lang-javascript';

// Top-level names available with no imports inside a script.
const TOP_LEVEL = [
  { label: 'out', type: 'variable', info: 'Output collector. Add geometry with out.strut(a, b) and out.ball(p); the playground builds a mesh from it after the script runs.' },
  { label: 'symmetry', type: 'namespace', info: 'Symmetry helpers for the active field — orbit(name) and catalog().' },
  { label: 'field', type: 'variable', info: 'The active algebraic number field (golden). Source of exact vZome coordinates.' },
  { label: 'origin', type: 'variable', info: 'The origin point (0, 0, 0) in the active field.' },
  { label: 'input', type: 'variable', info: 'The optional uploaded input file as text, or null when none was provided.' },
  { label: 'console', type: 'namespace', info: 'Logging — console.log / warn / error append a line to the output panel.' },
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
  symmetry: [
    snip('orbit(${name})', { label: 'orbit', type: 'method', detail: '(name)', info: 'Directions of a named orbit (zone) in the active symmetry group.' }),
    snip('catalog()', { label: 'catalog', type: 'method', detail: '()', info: 'List the available orbit (zone) names.' }),
  ],
  console: [
    snip('log(${msg})', { label: 'log', type: 'method', detail: '(...args)', info: 'Append a line to the output panel.' }),
    snip('warn(${msg})', { label: 'warn', type: 'method', detail: '(...args)', info: 'Append a line to the output panel.' }),
    snip('error(${msg})', { label: 'error', type: 'method', detail: '(...args)', info: 'Append a line to the output panel.' }),
  ],
};

function apiCompletionSource(context) {
  // Member access: `out.`, `symmetry.or`, etc. Only claim names we document;
  // returning null for anything else lets other sources (and `field.` from the
  // real engine) fall through untouched.
  const member = context.matchBefore(/([A-Za-z_$][\w$]*)\.\w*$/);
  if (member) {
    const obj = member.text.slice(0, member.text.indexOf('.'));
    const options = MEMBERS[obj];
    if (!options) return null;
    return { from: member.from + obj.length + 1, options };
  }

  // Top-level identifier. Don't pop up on an empty position unless explicitly
  // requested (Ctrl-Space); otherwise complete the magic-API names.
  const word = context.matchBefore(/[\w$]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return { from: word.from, options: TOP_LEVEL };
}

export const apiCompletions = javascriptLanguage.data.of({
  autocomplete: apiCompletionSource,
});
