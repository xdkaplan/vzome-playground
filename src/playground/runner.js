// Executes a user script one-shot against the engine, returning a mesh.
//
// The "magic" is scope injection: the facade globals are passed as named
// function arguments via `new Function`, so the script can reference `field`,
// `symmetry`, `out`, `input`, `origin` directly with no imports. This is NOT a
// security sandbox (user code shares the worker context) — acceptable for a
// single-user "run my own code" playground.

import { buildFacade } from './facade.js';

export function runScript(code, engine, input, logSink) {
  const { globals, out } = buildFacade(engine);
  globals.input = input ?? null;

  // Capture console.log from the script into the output panel.
  const consoleProxy = {
    log: (...args) => logSink(args.map(String).join(' ')),
    warn: (...args) => logSink(args.map(String).join(' ')),
    error: (...args) => logSink(args.map(String).join(' ')),
  };

  const argNames = [...Object.keys(globals), 'console'];
  const argValues = [...Object.values(globals), consoleProxy];

  const fn = new Function(...argNames, `"use strict";\n${code}`);
  fn(...argValues);

  return engine.buildMesh(out.struts, out.balls);
}
